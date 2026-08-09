use crate::SimulationError;
use cnc_render_contracts::{domain::Vec3Mm, semantic_hash};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

const NUMERIC_EPSILON: f64 = 1e-9;
const DEFAULT_MEMORY_CAP_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MillingQualityPreset {
    Preview,
    Balanced,
    Precision,
}

impl MillingQualityPreset {
    fn resolution_multiplier(self) -> f64 {
        match self {
            Self::Preview => 2.0,
            Self::Balanced => 1.0,
            Self::Precision => 0.5,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MillingStockInput {
    pub size_mm: Vec3Mm,
    pub position_mm: Vec3Mm,
    pub base_resolution_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MillingToolInput {
    pub diameter_mm: f64,
    pub cutting_length_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MillingSweep {
    pub start_mm: Vec3Mm,
    pub end_mm: Vec3Mm,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MillingSweepResult {
    pub revision: u64,
    pub updated_dexels: usize,
    pub dirty_bricks: usize,
    pub removed_volume_delta_mm3: f64,
    pub removed_volume_mm3: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MillingStockDiagnostics {
    pub resolution_mm: f64,
    pub columns: usize,
    pub rows: usize,
    pub allocated_bricks: usize,
    pub allocated_bytes: usize,
    pub revision: u64,
    pub removed_volume_mm3: f64,
}

#[derive(Debug, Clone)]
struct Bounds {
    minimum: Vec3Mm,
    maximum: Vec3Mm,
}

#[derive(Debug, Clone)]
pub struct SparseDexelMillingEngine {
    preset: MillingQualityPreset,
    seed: u32,
    brick_size_dexels: usize,
    memory_cap_bytes: usize,
    resolution_mm: f64,
    columns: usize,
    rows: usize,
    maximum_depth_layers: u32,
    cutter_radius_mm: f64,
    cutting_length_mm: f64,
    bounds: Bounds,
    bricks: BTreeMap<(usize, usize), Vec<u32>>,
    revision: u64,
    removed_volume_mm3: f64,
}

impl SparseDexelMillingEngine {
    pub fn new(
        stock: MillingStockInput,
        tool: MillingToolInput,
        preset: MillingQualityPreset,
        seed: u32,
        brick_size_dexels: usize,
    ) -> Result<Self, SimulationError> {
        validate_positive_vec3(&stock.size_mm, "stock.sizeMm")?;
        validate_finite_vec3(&stock.position_mm, "stock.positionMm")?;
        if !stock.base_resolution_mm.is_finite() || stock.base_resolution_mm <= 0.0 {
            return Err(SimulationError::new(
                "material-removal.resolution.invalid",
                "The base representation resolution must be positive and finite.",
            ));
        }
        if !tool.diameter_mm.is_finite()
            || tool.diameter_mm <= 0.0
            || !tool.cutting_length_mm.is_finite()
            || tool.cutting_length_mm <= 0.0
        {
            return Err(SimulationError::new(
                "material-removal.tool.invalid",
                "The cutter diameter and cutting length must be positive and finite.",
            ));
        }
        if !(4..=64).contains(&brick_size_dexels) {
            return Err(SimulationError::new(
                "material-removal.brick-size.invalid",
                "brickSizeDexels must be in the inclusive range 4..=64.",
            ));
        }

        let resolution_mm = stock.base_resolution_mm * preset.resolution_multiplier();
        let columns = checked_grid_count(stock.size_mm.x_mm, resolution_mm, "X")?;
        let rows = checked_grid_count(stock.size_mm.y_mm, resolution_mm, "Y")?;
        let maximum_depth_layers =
            checked_grid_count(stock.size_mm.z_mm, resolution_mm, "Z")? as u32;
        if columns
            .checked_mul(rows)
            .is_none_or(|cell_count| cell_count > u32::MAX as usize)
        {
            return Err(SimulationError::new(
                "material-removal.grid.invalid",
                "The sparse dexel grid exceeds the Uint32 representation limits.",
            ));
        }
        let half_x = stock.size_mm.x_mm / 2.0;
        let half_y = stock.size_mm.y_mm / 2.0;
        let half_z = stock.size_mm.z_mm / 2.0;
        let bounds = Bounds {
            minimum: Vec3Mm {
                x_mm: normalized_zero(stock.position_mm.x_mm - half_x),
                y_mm: normalized_zero(stock.position_mm.y_mm - half_y),
                z_mm: normalized_zero(stock.position_mm.z_mm - half_z),
            },
            maximum: Vec3Mm {
                x_mm: normalized_zero(stock.position_mm.x_mm + half_x),
                y_mm: normalized_zero(stock.position_mm.y_mm + half_y),
                z_mm: normalized_zero(stock.position_mm.z_mm + half_z),
            },
        };

        Ok(Self {
            preset,
            seed,
            brick_size_dexels,
            memory_cap_bytes: DEFAULT_MEMORY_CAP_BYTES,
            resolution_mm,
            columns,
            rows,
            maximum_depth_layers,
            cutter_radius_mm: tool.diameter_mm / 2.0,
            cutting_length_mm: tool.cutting_length_mm,
            bounds,
            bricks: BTreeMap::new(),
            revision: 0,
            removed_volume_mm3: 0.0,
        })
    }

    pub fn apply_sweep(
        &mut self,
        sweep: &MillingSweep,
    ) -> Result<MillingSweepResult, SimulationError> {
        validate_finite_vec3(&sweep.start_mm, "sweep.startMm")?;
        validate_finite_vec3(&sweep.end_mm, "sweep.endMm")?;

        let top_z_mm = self.bounds.maximum.z_mm;
        let lowest_tip_z_mm = sweep.start_mm.z_mm.min(sweep.end_mm.z_mm);
        let requested_depth_mm = top_z_mm - lowest_tip_z_mm;
        if requested_depth_mm > self.cutting_length_mm + NUMERIC_EPSILON {
            return Err(SimulationError::new(
                "material-removal.tool.cutting-length-exceeded",
                "The requested cut exceeds the cutter cutting length.",
            ));
        }

        let column_range = self.index_range(
            sweep.start_mm.x_mm.min(sweep.end_mm.x_mm) - self.cutter_radius_mm,
            sweep.start_mm.x_mm.max(sweep.end_mm.x_mm) + self.cutter_radius_mm,
            true,
        );
        let row_range = self.index_range(
            sweep.start_mm.y_mm.min(sweep.end_mm.y_mm) - self.cutter_radius_mm,
            sweep.start_mm.y_mm.max(sweep.end_mm.y_mm) + self.cutter_radius_mm,
            false,
        );
        let mut updated_dexels = 0;
        let mut removed_volume_delta_mm3 = 0.0;
        let mut dirty_bricks = BTreeMap::<(usize, usize), ()>::new();

        if let (Some((minimum_column, maximum_column)), Some((minimum_row, maximum_row))) =
            (column_range, row_range)
            && requested_depth_mm > 0.0
        {
            for row in minimum_row..=maximum_row {
                let y_mm = self.cell_center(row, false);
                for column in minimum_column..=maximum_column {
                    let x_mm = self.cell_center(column, true);
                    let Some(minimum_tip_z_mm) = self.minimum_swept_tip_z(sweep, x_mm, y_mm) else {
                        continue;
                    };
                    if minimum_tip_z_mm >= top_z_mm {
                        continue;
                    }

                    let requested_layers = (((top_z_mm - minimum_tip_z_mm) / self.resolution_mm)
                        .round() as u32)
                        .min(self.maximum_depth_layers);
                    if requested_layers == 0 {
                        continue;
                    }

                    let (brick_x, brick_y, local_index) = self.brick_location(column, row);
                    let previous_layers = self
                        .bricks
                        .get(&(brick_y, brick_x))
                        .map_or(0, |brick| brick[local_index]);
                    if requested_layers <= previous_layers {
                        continue;
                    }
                    self.ensure_brick(brick_x, brick_y)?;
                    self.bricks
                        .get_mut(&(brick_y, brick_x))
                        .expect("the sparse brick was just allocated")[local_index] =
                        requested_layers;
                    dirty_bricks.insert((brick_y, brick_x), ());
                    updated_dexels += 1;
                    removed_volume_delta_mm3 += (self.depth_mm(requested_layers)
                        - self.depth_mm(previous_layers))
                        * self.cell_width(column)
                        * self.cell_height(row);
                }
            }
        }

        if updated_dexels > 0 {
            self.revision += 1;
            self.removed_volume_mm3 =
                normalized_zero(self.removed_volume_mm3 + removed_volume_delta_mm3);
        }

        Ok(MillingSweepResult {
            revision: self.revision,
            updated_dexels,
            dirty_bricks: dirty_bricks.len(),
            removed_volume_delta_mm3: normalized_zero(removed_volume_delta_mm3),
            removed_volume_mm3: self.removed_volume_mm3,
        })
    }

    pub fn stock_hash_sha256(&self) -> Result<String, SimulationError> {
        semantic_hash(&self.stock_hash_manifest()).map_err(|error| {
            SimulationError::new(
                "material-removal.stock-hash.failed",
                format!("Could not hash the canonical stock manifest: {error}"),
            )
        })
    }

    pub fn diagnostics(&self) -> MillingStockDiagnostics {
        MillingStockDiagnostics {
            resolution_mm: self.resolution_mm,
            columns: self.columns,
            rows: self.rows,
            allocated_bricks: self.bricks.len(),
            allocated_bytes: self.bricks.len()
                * self.brick_size_dexels
                * self.brick_size_dexels
                * size_of::<u32>(),
            revision: self.revision,
            removed_volume_mm3: self.removed_volume_mm3,
        }
    }

    fn stock_hash_manifest(&self) -> Value {
        let bricks = self
            .bricks
            .iter()
            .map(|((brick_y, brick_x), removed_depth_layers)| {
                json!({
                    "brickX": brick_x,
                    "brickY": brick_y,
                    "removedDepthLayers": removed_depth_layers,
                })
            })
            .collect::<Vec<_>>();
        json!({
            "schema": "cnc-render.stock-hash.v1",
            "seed": self.seed,
            "preset": self.preset,
            "resolutionMm": self.resolution_mm,
            "boundsMm": {
                "minimum": {
                    "xMm": self.bounds.minimum.x_mm,
                    "yMm": self.bounds.minimum.y_mm,
                    "zMm": self.bounds.minimum.z_mm,
                },
                "maximum": {
                    "xMm": self.bounds.maximum.x_mm,
                    "yMm": self.bounds.maximum.y_mm,
                    "zMm": self.bounds.maximum.z_mm,
                },
            },
            "grid": {
                "columns": self.columns,
                "rows": self.rows,
                "brickSizeDexels": self.brick_size_dexels,
            },
            "bricks": bricks,
        })
    }

    fn minimum_swept_tip_z(&self, sweep: &MillingSweep, x_mm: f64, y_mm: f64) -> Option<f64> {
        let delta_x = sweep.end_mm.x_mm - sweep.start_mm.x_mm;
        let delta_y = sweep.end_mm.y_mm - sweep.start_mm.y_mm;
        let delta_z = sweep.end_mm.z_mm - sweep.start_mm.z_mm;
        let length_squared = delta_x * delta_x + delta_y * delta_y;
        let radius_squared = self.cutter_radius_mm * self.cutter_radius_mm;

        if length_squared <= NUMERIC_EPSILON {
            let distance_squared =
                (x_mm - sweep.start_mm.x_mm).powi(2) + (y_mm - sweep.start_mm.y_mm).powi(2);
            return (distance_squared <= radius_squared + NUMERIC_EPSILON)
                .then(|| sweep.start_mm.z_mm.min(sweep.end_mm.z_mm));
        }

        let projection = ((x_mm - sweep.start_mm.x_mm) * delta_x
            + (y_mm - sweep.start_mm.y_mm) * delta_y)
            / length_squared;
        let closest_x = sweep.start_mm.x_mm + projection * delta_x;
        let closest_y = sweep.start_mm.y_mm + projection * delta_y;
        let perpendicular_distance_squared =
            (x_mm - closest_x).powi(2) + (y_mm - closest_y).powi(2);
        if perpendicular_distance_squared > radius_squared + NUMERIC_EPSILON {
            return None;
        }

        let extent =
            ((radius_squared - perpendicular_distance_squared).max(0.0) / length_squared).sqrt();
        let minimum_t = 0.0_f64.max(projection - extent);
        let maximum_t = 1.0_f64.min(projection + extent);
        if minimum_t > maximum_t + NUMERIC_EPSILON {
            return None;
        }
        let selected_t = if delta_z >= 0.0 { minimum_t } else { maximum_t };
        Some(sweep.start_mm.z_mm + selected_t * delta_z)
    }

    fn index_range(
        &self,
        minimum_mm: f64,
        maximum_mm: f64,
        x_axis: bool,
    ) -> Option<(usize, usize)> {
        let bounds_minimum = if x_axis {
            self.bounds.minimum.x_mm
        } else {
            self.bounds.minimum.y_mm
        };
        let count = if x_axis { self.columns } else { self.rows };
        let minimum = ((minimum_mm - bounds_minimum) / self.resolution_mm).floor() as i64;
        let maximum = ((maximum_mm - bounds_minimum) / self.resolution_mm).floor() as i64;
        let clamped_minimum = minimum.max(0);
        let clamped_maximum = maximum.min(count as i64 - 1);
        (clamped_minimum <= clamped_maximum)
            .then_some((clamped_minimum as usize, clamped_maximum as usize))
    }

    fn brick_location(&self, column: usize, row: usize) -> (usize, usize, usize) {
        let brick_x = column / self.brick_size_dexels;
        let brick_y = row / self.brick_size_dexels;
        let local_column = column % self.brick_size_dexels;
        let local_row = row % self.brick_size_dexels;
        (
            brick_x,
            brick_y,
            local_row * self.brick_size_dexels + local_column,
        )
    }

    fn ensure_brick(&mut self, brick_x: usize, brick_y: usize) -> Result<(), SimulationError> {
        if self.bricks.contains_key(&(brick_y, brick_x)) {
            return Ok(());
        }
        let next_allocated_bytes = (self.bricks.len() + 1)
            * self.brick_size_dexels
            * self.brick_size_dexels
            * size_of::<u32>();
        if next_allocated_bytes > self.memory_cap_bytes {
            return Err(SimulationError::new(
                "material-removal.memory-cap.exceeded",
                "Sparse stock allocation would exceed the configured memory cap.",
            ));
        }
        self.bricks.insert(
            (brick_y, brick_x),
            vec![0; self.brick_size_dexels * self.brick_size_dexels],
        );
        Ok(())
    }

    fn depth_mm(&self, layers: u32) -> f64 {
        (f64::from(layers) * self.resolution_mm)
            .min(self.bounds.maximum.z_mm - self.bounds.minimum.z_mm)
    }

    fn cell_center(&self, index: usize, x_axis: bool) -> f64 {
        let minimum = if x_axis {
            self.bounds.minimum.x_mm
        } else {
            self.bounds.minimum.y_mm
        };
        let maximum = if x_axis {
            self.bounds.maximum.x_mm
        } else {
            self.bounds.maximum.y_mm
        };
        let start = minimum + index as f64 * self.resolution_mm;
        let end = maximum.min(start + self.resolution_mm);
        (start + end) / 2.0
    }

    fn cell_width(&self, column: usize) -> f64 {
        self.resolution_mm.min(
            self.bounds.maximum.x_mm
                - (self.bounds.minimum.x_mm + column as f64 * self.resolution_mm),
        )
    }

    fn cell_height(&self, row: usize) -> f64 {
        self.resolution_mm.min(
            self.bounds.maximum.y_mm - (self.bounds.minimum.y_mm + row as f64 * self.resolution_mm),
        )
    }
}

fn checked_grid_count(
    size_mm: f64,
    resolution_mm: f64,
    axis: &str,
) -> Result<usize, SimulationError> {
    let count = (size_mm / resolution_mm).ceil();
    if !count.is_finite() || count < 1.0 || count > u32::MAX as f64 {
        return Err(SimulationError::new(
            "material-removal.grid.invalid",
            format!("{axis} grid size is outside the supported range."),
        ));
    }
    Ok(count as usize)
}

fn validate_positive_vec3(value: &Vec3Mm, label: &str) -> Result<(), SimulationError> {
    validate_finite_vec3(value, label)?;
    if value.x_mm <= 0.0 || value.y_mm <= 0.0 || value.z_mm <= 0.0 {
        return Err(SimulationError::new(
            "material-removal.stock.size-invalid",
            format!("{label} must contain positive millimetre values."),
        ));
    }
    Ok(())
}

fn validate_finite_vec3(value: &Vec3Mm, label: &str) -> Result<(), SimulationError> {
    if !value.x_mm.is_finite() || !value.y_mm.is_finite() || !value.z_mm.is_finite() {
        return Err(SimulationError::new(
            "material-removal.input.nonfinite",
            format!("{label} must contain finite millimetre values."),
        ));
    }
    Ok(())
}

fn normalized_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenFixture {
        seed: u32,
        brick_size_dexels: usize,
        stock: MillingStockInput,
        preset_relative_volume_error_limits: BTreeMap<String, f64>,
        fixtures: Vec<GoldenItem>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenItem {
        id: String,
        tool: MillingToolInput,
        expected_removed_volume_mm3: f64,
        sweeps: Vec<MillingSweep>,
    }

    fn fixture() -> GoldenFixture {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/material-removal/milling/milling-golden.json"
        ))
        .expect("M5 milling Golden fixture must deserialize")
    }

    #[test]
    fn matches_analytic_volume_budgets_for_every_preset() {
        let fixture = fixture();
        let presets = [
            (MillingQualityPreset::Preview, "preview"),
            (MillingQualityPreset::Balanced, "balanced"),
            (MillingQualityPreset::Precision, "precision"),
        ];
        for item in fixture.fixtures {
            for (preset, preset_name) in presets {
                let mut engine = SparseDexelMillingEngine::new(
                    fixture.stock.clone(),
                    item.tool.clone(),
                    preset,
                    fixture.seed,
                    fixture.brick_size_dexels,
                )
                .expect("Golden engine must initialize");
                for sweep in &item.sweeps {
                    engine
                        .apply_sweep(sweep)
                        .expect("Golden sweep must execute");
                }
                let error = (engine.removed_volume_mm3 - item.expected_removed_volume_mm3).abs()
                    / item.expected_removed_volume_mm3;
                assert!(
                    error <= fixture.preset_relative_volume_error_limits[preset_name],
                    "{} {preset_name} error {error}",
                    item.id
                );
            }
        }
    }

    #[test]
    fn non_contact_is_zero_and_hash_is_stable() {
        let fixture = fixture();
        let item = &fixture.fixtures[1];
        let mut engine = SparseDexelMillingEngine::new(
            fixture.stock,
            item.tool.clone(),
            MillingQualityPreset::Balanced,
            fixture.seed,
            fixture.brick_size_dexels,
        )
        .expect("Golden engine must initialize");
        let before_hash = engine.stock_hash_sha256().expect("before hash");
        let result = engine
            .apply_sweep(&MillingSweep {
                start_mm: Vec3Mm {
                    x_mm: -25.0,
                    y_mm: 0.0,
                    z_mm: 12.0,
                },
                end_mm: Vec3Mm {
                    x_mm: 25.0,
                    y_mm: 0.0,
                    z_mm: 12.0,
                },
            })
            .expect("non-contact sweep must execute");
        assert_eq!(result.updated_dexels, 0);
        assert_eq!(result.removed_volume_mm3, 0.0);
        assert_eq!(engine.diagnostics().allocated_bricks, 0);
        assert_eq!(before_hash, engine.stock_hash_sha256().expect("after hash"));
    }
}
