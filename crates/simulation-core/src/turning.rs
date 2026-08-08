use crate::SimulationError;
use cnc_render_contracts::{domain::Vec3Mm, semantic_hash};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::f64::consts::PI;

const NUMERIC_EPSILON: f64 = 1e-9;
const DEFAULT_MEMORY_CAP_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TurningQualityPreset {
    Preview,
    Balanced,
    Precision,
}

impl TurningQualityPreset {
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
pub struct TurningStockInput {
    pub diameter_mm: f64,
    pub length_mm: f64,
    pub position_mm: Vec3Mm,
    pub base_resolution_mm: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TurningToolKind {
    Turning,
    Drill,
    Boring,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TurningCut {
    Facing {
        face_z_mm: f64,
        free_end: TurningFreeEnd,
    },
    OdTurning {
        start_z_mm: f64,
        end_z_mm: f64,
        start_outer_radius_mm: f64,
        end_outer_radius_mm: f64,
    },
    Taper {
        start_z_mm: f64,
        end_z_mm: f64,
        start_outer_radius_mm: f64,
        end_outer_radius_mm: f64,
    },
    Groove {
        start_z_mm: f64,
        end_z_mm: f64,
        start_outer_radius_mm: f64,
        end_outer_radius_mm: f64,
    },
    Parting {
        start_z_mm: f64,
        end_z_mm: f64,
        start_outer_radius_mm: f64,
        end_outer_radius_mm: f64,
    },
    Drilling {
        start_z_mm: f64,
        end_z_mm: f64,
        start_inner_radius_mm: f64,
        end_inner_radius_mm: f64,
    },
    Boring {
        start_z_mm: f64,
        end_z_mm: f64,
        start_inner_radius_mm: f64,
        end_inner_radius_mm: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TurningFreeEnd {
    #[serde(rename = "negative-z")]
    NegativeZ,
    #[serde(rename = "positive-z")]
    PositiveZ,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurningCutResult {
    pub revision: u64,
    pub updated_cells: usize,
    pub removed_volume_delta_mm3: f64,
    pub removed_volume_mm3: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurningProfileSample {
    pub cell_index: usize,
    pub center_z_mm: f64,
    pub inner_radius_mm: f64,
    pub outer_radius_mm: f64,
    pub representation_resolution_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurningProfileDiagnostics {
    pub resolution_mm: f64,
    pub axial_cells: usize,
    pub revision: u64,
    pub allocated_bytes: usize,
    pub memory_cap_bytes: usize,
    pub removed_volume_mm3: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurningProfileSnapshot {
    pub profile_version: u32,
    pub representation: String,
    pub seed: u32,
    pub preset: TurningQualityPreset,
    pub resolution_mm: f64,
    pub axis_center_mm: TurningAxisCenter,
    pub minimum_z_mm: f64,
    pub maximum_z_mm: f64,
    pub initial_radius_mm: f64,
    pub axial_cells: usize,
    pub outer_radius_layers: Vec<u32>,
    pub inner_radius_layers: Vec<u32>,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurningProfilePatch {
    pub revision: u64,
    pub cell_indices: Vec<u32>,
    pub inner_radius_mm: Vec<f32>,
    pub outer_radius_mm: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurningAxisCenter {
    pub x_mm: f64,
    pub y_mm: f64,
}

#[derive(Debug, Clone)]
pub struct LatheRadiusFieldEngine {
    preset: TurningQualityPreset,
    seed: u32,
    resolution_mm: f64,
    axial_cells: usize,
    initial_radius_mm: f64,
    maximum_radius_layers: u32,
    axis_center_mm: TurningAxisCenter,
    minimum_z_mm: f64,
    maximum_z_mm: f64,
    tool_kind: TurningToolKind,
    machine_max_spindle_speed_rpm: f64,
    chuck_grip_length_mm: f64,
    memory_cap_bytes: usize,
    outer_radius_layers: Vec<u32>,
    inner_radius_layers: Vec<u32>,
    dirty_cells: BTreeSet<usize>,
    revision: u64,
    removed_volume_mm3: f64,
}

impl LatheRadiusFieldEngine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        stock: TurningStockInput,
        tool_kind: TurningToolKind,
        preset: TurningQualityPreset,
        seed: u32,
        machine_max_spindle_speed_rpm: f64,
        chuck_grip_length_mm: f64,
    ) -> Result<Self, SimulationError> {
        validate_positive(stock.diameter_mm, "stock.diameterMm")?;
        validate_positive(stock.length_mm, "stock.lengthMm")?;
        validate_positive(stock.base_resolution_mm, "stock.baseResolutionMm")?;
        validate_finite_vec3(&stock.position_mm, "stock.positionMm")?;
        validate_positive(machine_max_spindle_speed_rpm, "machineMaxSpindleSpeedRpm")?;
        if !chuck_grip_length_mm.is_finite()
            || chuck_grip_length_mm < 0.0
            || chuck_grip_length_mm >= stock.length_mm
        {
            return Err(SimulationError::new(
                "turning.chuck-grip.invalid",
                "chuckGripLengthMm must be non-negative and shorter than Stock.",
            ));
        }
        let resolution_mm = stock.base_resolution_mm * preset.resolution_multiplier();
        let axial_cells = checked_grid_count(stock.length_mm, resolution_mm)?;
        let initial_radius_mm = stock.diameter_mm / 2.0;
        let maximum_radius_layers = checked_grid_count(initial_radius_mm, resolution_mm)? as u32;
        let allocated_bytes = axial_cells
            .checked_mul(size_of::<u32>() * 2)
            .ok_or_else(|| {
                SimulationError::new(
                    "turning.grid.invalid",
                    "Radius-field allocation overflowed.",
                )
            })?;
        if allocated_bytes > DEFAULT_MEMORY_CAP_BYTES {
            return Err(SimulationError::new(
                "turning.grid.invalid",
                "The radius field exceeds the configured memory cap.",
            ));
        }
        let half_length = stock.length_mm / 2.0;
        Ok(Self {
            preset,
            seed,
            resolution_mm,
            axial_cells,
            initial_radius_mm,
            maximum_radius_layers,
            axis_center_mm: TurningAxisCenter {
                x_mm: stock.position_mm.x_mm,
                y_mm: stock.position_mm.y_mm,
            },
            minimum_z_mm: normalized_zero(stock.position_mm.z_mm - half_length),
            maximum_z_mm: normalized_zero(stock.position_mm.z_mm + half_length),
            tool_kind,
            machine_max_spindle_speed_rpm,
            chuck_grip_length_mm,
            memory_cap_bytes: DEFAULT_MEMORY_CAP_BYTES,
            outer_radius_layers: vec![maximum_radius_layers; axial_cells],
            inner_radius_layers: vec![0; axial_cells],
            dirty_cells: BTreeSet::new(),
            revision: 0,
            removed_volume_mm3: 0.0,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn restore_profile(
        stock: TurningStockInput,
        tool_kind: TurningToolKind,
        preset: TurningQualityPreset,
        seed: u32,
        machine_max_spindle_speed_rpm: f64,
        chuck_grip_length_mm: f64,
        snapshot: &TurningProfileSnapshot,
    ) -> Result<Self, SimulationError> {
        let mut engine = Self::new(
            stock,
            tool_kind,
            preset,
            seed,
            machine_max_spindle_speed_rpm,
            chuck_grip_length_mm,
        )?;
        engine.restore(snapshot)?;
        Ok(engine)
    }

    pub fn apply_cut(&mut self, cut: &TurningCut) -> Result<TurningCutResult, SimulationError> {
        self.validate_tool_for_cut(cut)?;
        let mut updated_cells = 0;
        let mut removed_volume_delta_mm3 = 0.0;
        for cell_index in 0..self.axial_cells {
            let center_z_mm = self.cell_center_z_mm(cell_index);
            let previous_outer = self.outer_radius_layers[cell_index];
            let previous_inner = self.inner_radius_layers[cell_index];
            let (next_outer, next_inner) = match cut {
                TurningCut::Facing {
                    face_z_mm,
                    free_end,
                } => {
                    validate_finite(*face_z_mm, "cut.faceZMm")?;
                    let remove = match free_end {
                        TurningFreeEnd::PositiveZ => center_z_mm >= *face_z_mm,
                        TurningFreeEnd::NegativeZ => center_z_mm <= *face_z_mm,
                    };
                    if remove {
                        (0, 0)
                    } else {
                        (previous_outer, previous_inner)
                    }
                }
                TurningCut::Drilling {
                    start_z_mm,
                    end_z_mm,
                    start_inner_radius_mm,
                    end_inner_radius_mm,
                }
                | TurningCut::Boring {
                    start_z_mm,
                    end_z_mm,
                    start_inner_radius_mm,
                    end_inner_radius_mm,
                } => {
                    validate_range(*start_z_mm, *end_z_mm)?;
                    if center_z_mm < *start_z_mm - NUMERIC_EPSILON
                        || center_z_mm > *end_z_mm + NUMERIC_EPSILON
                    {
                        (previous_outer, previous_inner)
                    } else {
                        let start =
                            self.validate_radius(*start_inner_radius_mm, "cut.startInnerRadiusMm")?;
                        let end =
                            self.validate_radius(*end_inner_radius_mm, "cut.endInnerRadiusMm")?;
                        let ratio = interpolation_ratio(center_z_mm, *start_z_mm, *end_z_mm);
                        let target = start + (end - start) * ratio;
                        let target_layers = ((target / self.resolution_mm - NUMERIC_EPSILON).ceil()
                            as u32)
                            .min(previous_outer);
                        (previous_outer, previous_inner.max(target_layers))
                    }
                }
                TurningCut::OdTurning {
                    start_z_mm,
                    end_z_mm,
                    start_outer_radius_mm,
                    end_outer_radius_mm,
                }
                | TurningCut::Taper {
                    start_z_mm,
                    end_z_mm,
                    start_outer_radius_mm,
                    end_outer_radius_mm,
                }
                | TurningCut::Groove {
                    start_z_mm,
                    end_z_mm,
                    start_outer_radius_mm,
                    end_outer_radius_mm,
                }
                | TurningCut::Parting {
                    start_z_mm,
                    end_z_mm,
                    start_outer_radius_mm,
                    end_outer_radius_mm,
                } => {
                    validate_range(*start_z_mm, *end_z_mm)?;
                    if center_z_mm < *start_z_mm - NUMERIC_EPSILON
                        || center_z_mm > *end_z_mm + NUMERIC_EPSILON
                    {
                        (previous_outer, previous_inner)
                    } else {
                        let start =
                            self.validate_radius(*start_outer_radius_mm, "cut.startOuterRadiusMm")?;
                        let end =
                            self.validate_radius(*end_outer_radius_mm, "cut.endOuterRadiusMm")?;
                        let ratio = interpolation_ratio(center_z_mm, *start_z_mm, *end_z_mm);
                        let target = start + (end - start) * ratio;
                        let target_layers =
                            ((target / self.resolution_mm + NUMERIC_EPSILON).floor() as u32)
                                .min(self.maximum_radius_layers);
                        let outer = previous_outer.min(target_layers);
                        (outer, previous_inner.min(outer))
                    }
                }
            };
            if next_outer == previous_outer && next_inner == previous_inner {
                continue;
            }
            let before_area = self.material_area_mm2(previous_outer, previous_inner);
            let after_area = self.material_area_mm2(next_outer, next_inner);
            if after_area > before_area + NUMERIC_EPSILON {
                return Err(SimulationError::new(
                    "turning.material.non-monotonic",
                    "A turning cut must not increase Stock material.",
                ));
            }
            self.outer_radius_layers[cell_index] = next_outer;
            self.inner_radius_layers[cell_index] = next_inner;
            self.dirty_cells.insert(cell_index);
            updated_cells += 1;
            removed_volume_delta_mm3 += (before_area - after_area) * self.cell_width_mm(cell_index);
        }
        if updated_cells > 0 {
            self.revision += 1;
            self.removed_volume_mm3 =
                normalized_zero(self.removed_volume_mm3 + removed_volume_delta_mm3);
        }
        Ok(TurningCutResult {
            revision: self.revision,
            updated_cells,
            removed_volume_delta_mm3: normalized_zero(removed_volume_delta_mm3),
            removed_volume_mm3: self.removed_volume_mm3,
        })
    }

    pub fn profile_at(&self, z_mm: f64) -> Result<TurningProfileSample, SimulationError> {
        validate_finite(z_mm, "zMm")?;
        if z_mm < self.minimum_z_mm || z_mm > self.maximum_z_mm {
            return Err(SimulationError::new(
                "turning.measurement.outside-stock",
                "Profile measurement Z must be inside Stock bounds.",
            ));
        }
        let cell_index = (((z_mm - self.minimum_z_mm) / self.resolution_mm).floor() as usize)
            .min(self.axial_cells - 1);
        Ok(TurningProfileSample {
            cell_index,
            center_z_mm: self.cell_center_z_mm(cell_index),
            inner_radius_mm: self.inner_radius_mm(cell_index),
            outer_radius_mm: self.outer_radius_mm(cell_index),
            representation_resolution_mm: self.resolution_mm,
        })
    }

    pub fn serialize_profile(&self) -> TurningProfileSnapshot {
        TurningProfileSnapshot {
            profile_version: 1,
            representation: "lathe-radius-field".to_owned(),
            seed: self.seed,
            preset: self.preset,
            resolution_mm: self.resolution_mm,
            axis_center_mm: self.axis_center_mm.clone(),
            minimum_z_mm: self.minimum_z_mm,
            maximum_z_mm: self.maximum_z_mm,
            initial_radius_mm: self.initial_radius_mm,
            axial_cells: self.axial_cells,
            outer_radius_layers: self.outer_radius_layers.clone(),
            inner_radius_layers: self.inner_radius_layers.clone(),
            revision: self.revision,
        }
    }

    pub fn drain_dirty_profile_patch(&mut self) -> TurningProfilePatch {
        let dirty_cells = std::mem::take(&mut self.dirty_cells);
        let mut cell_indices = Vec::with_capacity(dirty_cells.len());
        let mut inner_radius_mm = Vec::with_capacity(dirty_cells.len());
        let mut outer_radius_mm = Vec::with_capacity(dirty_cells.len());
        for cell_index in dirty_cells {
            cell_indices.push(cell_index as u32);
            inner_radius_mm.push(self.inner_radius_mm(cell_index) as f32);
            outer_radius_mm.push(self.outer_radius_mm(cell_index) as f32);
        }
        TurningProfilePatch {
            revision: self.revision,
            cell_indices,
            inner_radius_mm,
            outer_radius_mm,
        }
    }

    pub fn profile_hash_sha256(&self) -> Result<String, SimulationError> {
        semantic_hash(&self.profile_hash_manifest()).map_err(|error| {
            SimulationError::new(
                "turning.profile-hash.failed",
                format!("Could not hash the canonical lathe profile: {error}"),
            )
        })
    }

    pub fn diagnostics(&self) -> TurningProfileDiagnostics {
        TurningProfileDiagnostics {
            resolution_mm: self.resolution_mm,
            axial_cells: self.axial_cells,
            revision: self.revision,
            allocated_bytes: self.axial_cells * size_of::<u32>() * 2,
            memory_cap_bytes: self.memory_cap_bytes,
            removed_volume_mm3: self.removed_volume_mm3,
        }
    }

    pub fn resolve_spindle_speed(
        &self,
        mode: LatheSpindleMode,
        commanded_value: f64,
        diameter_mm: f64,
        tool_max_spindle_speed_rpm: f64,
    ) -> Result<LatheSpindleSpeedResult, SimulationError> {
        resolve_lathe_spindle_speed(
            mode,
            commanded_value,
            diameter_mm,
            self.machine_max_spindle_speed_rpm,
            tool_max_spindle_speed_rpm,
        )
    }

    pub fn detect_restricted_zone_collision(
        &self,
        x_mm: f64,
        z_mm: f64,
    ) -> Result<Option<TurningRestrictedZoneCollision>, SimulationError> {
        validate_finite(x_mm, "pose.xMm")?;
        validate_finite(z_mm, "pose.zMm")?;
        if z_mm <= self.minimum_z_mm + self.chuck_grip_length_mm {
            return Ok(Some(TurningRestrictedZoneCollision {
                code: "turning.collision.chuck".to_owned(),
                kind: TurningCollisionKind::Chuck,
                x_mm,
                y_mm: self.axis_center_mm.y_mm,
                z_mm,
            }));
        }
        if x_mm < self.axis_center_mm.x_mm - NUMERIC_EPSILON {
            return Ok(Some(TurningRestrictedZoneCollision {
                code: "turning.collision.axis-opposite-side".to_owned(),
                kind: TurningCollisionKind::AxisOppositeSide,
                x_mm,
                y_mm: self.axis_center_mm.y_mm,
                z_mm,
            }));
        }
        Ok(None)
    }

    fn restore(&mut self, snapshot: &TurningProfileSnapshot) -> Result<(), SimulationError> {
        if snapshot.profile_version != 1
            || snapshot.representation != "lathe-radius-field"
            || snapshot.seed != self.seed
            || snapshot.preset != self.preset
            || !close(snapshot.resolution_mm, self.resolution_mm)
            || !close(snapshot.axis_center_mm.x_mm, self.axis_center_mm.x_mm)
            || !close(snapshot.axis_center_mm.y_mm, self.axis_center_mm.y_mm)
            || !close(snapshot.minimum_z_mm, self.minimum_z_mm)
            || !close(snapshot.maximum_z_mm, self.maximum_z_mm)
            || !close(snapshot.initial_radius_mm, self.initial_radius_mm)
            || snapshot.axial_cells != self.axial_cells
            || snapshot.outer_radius_layers.len() != self.axial_cells
            || snapshot.inner_radius_layers.len() != self.axial_cells
        {
            return Err(SimulationError::new(
                "turning.snapshot.contract-mismatch",
                "The saved profile does not match the configured radius field.",
            ));
        }
        for (&outer, &inner) in snapshot
            .outer_radius_layers
            .iter()
            .zip(&snapshot.inner_radius_layers)
        {
            if outer > self.maximum_radius_layers || inner > outer {
                return Err(SimulationError::new(
                    "turning.snapshot.layers-invalid",
                    "Saved layers must satisfy 0 <= inner <= outer <= initial.",
                ));
            }
        }
        self.outer_radius_layers
            .clone_from(&snapshot.outer_radius_layers);
        self.inner_radius_layers
            .clone_from(&snapshot.inner_radius_layers);
        self.revision = snapshot.revision;
        self.removed_volume_mm3 = self.calculate_removed_volume_mm3();
        Ok(())
    }

    fn validate_tool_for_cut(&self, cut: &TurningCut) -> Result<(), SimulationError> {
        let compatible = match cut {
            TurningCut::Drilling { .. } => self.tool_kind == TurningToolKind::Drill,
            TurningCut::Boring { .. } => self.tool_kind == TurningToolKind::Boring,
            _ => self.tool_kind == TurningToolKind::Turning,
        };
        if !compatible {
            return Err(SimulationError::new(
                "turning.tool.operation-incompatible",
                "The selected tool is incompatible with this turning profile.",
            ));
        }
        Ok(())
    }

    fn validate_radius(&self, radius_mm: f64, label: &str) -> Result<f64, SimulationError> {
        validate_finite(radius_mm, label)?;
        if radius_mm < 0.0 || radius_mm > self.initial_radius_mm + NUMERIC_EPSILON {
            return Err(SimulationError::new(
                "turning.cut.radius-invalid",
                format!("{label} must stay inside the initial Stock radius."),
            ));
        }
        Ok(radius_mm.min(self.initial_radius_mm))
    }

    fn profile_hash_manifest(&self) -> Value {
        json!({
            "schema": "cnc-render.lathe-profile.v1",
            "seed": self.seed,
            "preset": self.preset,
            "resolutionMm": self.resolution_mm,
            "axisCenterMm": self.axis_center_mm,
            "minimumZMm": self.minimum_z_mm,
            "maximumZMm": self.maximum_z_mm,
            "initialRadiusMm": self.initial_radius_mm,
            "axialCells": self.axial_cells,
            "outerRadiusLayers": self.outer_radius_layers,
            "innerRadiusLayers": self.inner_radius_layers,
        })
    }

    fn cell_start_z_mm(&self, index: usize) -> f64 {
        self.minimum_z_mm + index as f64 * self.resolution_mm
    }

    fn cell_end_z_mm(&self, index: usize) -> f64 {
        self.maximum_z_mm
            .min(self.cell_start_z_mm(index) + self.resolution_mm)
    }

    fn cell_center_z_mm(&self, index: usize) -> f64 {
        (self.cell_start_z_mm(index) + self.cell_end_z_mm(index)) / 2.0
    }

    fn cell_width_mm(&self, index: usize) -> f64 {
        self.cell_end_z_mm(index) - self.cell_start_z_mm(index)
    }

    fn outer_radius_mm(&self, index: usize) -> f64 {
        self.initial_radius_mm
            .min(f64::from(self.outer_radius_layers[index]) * self.resolution_mm)
    }

    fn inner_radius_mm(&self, index: usize) -> f64 {
        self.outer_radius_mm(index)
            .min(f64::from(self.inner_radius_layers[index]) * self.resolution_mm)
    }

    fn material_area_mm2(&self, outer_layers: u32, inner_layers: u32) -> f64 {
        let outer = self
            .initial_radius_mm
            .min(f64::from(outer_layers) * self.resolution_mm);
        let inner = outer.min(f64::from(inner_layers) * self.resolution_mm);
        PI * (outer.powi(2) - inner.powi(2))
    }

    fn calculate_removed_volume_mm3(&self) -> f64 {
        let initial_area = PI * self.initial_radius_mm.powi(2);
        let mut removed = 0.0;
        for index in 0..self.axial_cells {
            removed += (initial_area
                - self.material_area_mm2(
                    self.outer_radius_layers[index],
                    self.inner_radius_layers[index],
                ))
                * self.cell_width_mm(index);
        }
        normalized_zero(removed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LatheSpindleMode {
    #[serde(rename = "rpm")]
    Rpm,
    #[serde(rename = "surface-speed")]
    SurfaceSpeed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatheSpindleSpeedResult {
    pub mode: LatheSpindleMode,
    pub requested_rpm: f64,
    pub effective_rpm: f64,
    pub maximum_rpm: f64,
    pub clamped: bool,
    pub effective_surface_speed_m_per_min: f64,
}

pub fn resolve_lathe_spindle_speed(
    mode: LatheSpindleMode,
    commanded_value: f64,
    diameter_mm: f64,
    machine_max_spindle_speed_rpm: f64,
    tool_max_spindle_speed_rpm: f64,
) -> Result<LatheSpindleSpeedResult, SimulationError> {
    validate_positive(commanded_value, "commandedValue")?;
    validate_positive(diameter_mm, "diameterMm")?;
    validate_positive(machine_max_spindle_speed_rpm, "machineMaxSpindleSpeedRpm")?;
    validate_positive(tool_max_spindle_speed_rpm, "toolMaxSpindleSpeedRpm")?;
    let maximum_rpm = machine_max_spindle_speed_rpm.min(tool_max_spindle_speed_rpm);
    let requested_rpm = match mode {
        LatheSpindleMode::Rpm => commanded_value,
        LatheSpindleMode::SurfaceSpeed => 1_000.0 * commanded_value / (PI * diameter_mm),
    };
    let effective_rpm = requested_rpm.min(maximum_rpm);
    Ok(LatheSpindleSpeedResult {
        mode,
        requested_rpm: normalized_zero(requested_rpm),
        effective_rpm: normalized_zero(effective_rpm),
        maximum_rpm,
        clamped: requested_rpm > maximum_rpm,
        effective_surface_speed_m_per_min: PI * diameter_mm * effective_rpm / 1_000.0,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TurningCollisionKind {
    AxisOppositeSide,
    Chuck,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurningRestrictedZoneCollision {
    pub code: String,
    pub kind: TurningCollisionKind,
    pub x_mm: f64,
    pub y_mm: f64,
    pub z_mm: f64,
}

fn interpolation_ratio(value: f64, start: f64, end: f64) -> f64 {
    if close(start, end) {
        0.0
    } else {
        (value - start) / (end - start)
    }
}

fn checked_grid_count(size_mm: f64, resolution_mm: f64) -> Result<usize, SimulationError> {
    let count = (size_mm / resolution_mm).ceil();
    if !count.is_finite() || count < 1.0 || count > u32::MAX as f64 {
        return Err(SimulationError::new(
            "turning.grid.invalid",
            "The radius-field grid is outside Uint32 limits.",
        ));
    }
    Ok(count as usize)
}

fn validate_range(start_z_mm: f64, end_z_mm: f64) -> Result<(), SimulationError> {
    validate_finite(start_z_mm, "cut.startZMm")?;
    validate_finite(end_z_mm, "cut.endZMm")?;
    if start_z_mm > end_z_mm {
        return Err(SimulationError::new(
            "turning.cut.range-invalid",
            "Turning profile ranges require startZMm <= endZMm.",
        ));
    }
    Ok(())
}

fn validate_positive(value: f64, label: &str) -> Result<(), SimulationError> {
    validate_finite(value, label)?;
    if value <= 0.0 {
        return Err(SimulationError::new(
            "turning.input.non-positive",
            format!("{label} must be positive."),
        ));
    }
    Ok(())
}

fn validate_finite(value: f64, label: &str) -> Result<(), SimulationError> {
    if !value.is_finite() {
        return Err(SimulationError::new(
            "turning.input.nonfinite",
            format!("{label} must be finite."),
        ));
    }
    Ok(())
}

fn validate_finite_vec3(value: &Vec3Mm, label: &str) -> Result<(), SimulationError> {
    if !value.x_mm.is_finite() || !value.y_mm.is_finite() || !value.z_mm.is_finite() {
        return Err(SimulationError::new(
            "turning.input.nonfinite",
            format!("{label} must contain finite millimetre values."),
        ));
    }
    Ok(())
}

fn close(left: f64, right: f64) -> bool {
    (left - right).abs() <= NUMERIC_EPSILON
}

fn normalized_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stock() -> TurningStockInput {
        TurningStockInput {
            diameter_mm: 80.0,
            length_mm: 120.0,
            position_mm: Vec3Mm {
                x_mm: 0.0,
                y_mm: 0.0,
                z_mm: 0.0,
            },
            base_resolution_mm: 1.0,
        }
    }

    #[test]
    fn profile_save_load_and_collision_are_deterministic() {
        let mut engine = LatheRadiusFieldEngine::new(
            stock(),
            TurningToolKind::Turning,
            TurningQualityPreset::Balanced,
            1_779_033_703,
            4_500.0,
            20.0,
        )
        .expect("valid turning engine");
        engine
            .apply_cut(&TurningCut::Taper {
                start_z_mm: -20.0,
                end_z_mm: 50.0,
                start_outer_radius_mm: 35.0,
                end_outer_radius_mm: 20.0,
            })
            .expect("valid taper");
        let snapshot = engine.serialize_profile();
        let restored = LatheRadiusFieldEngine::restore_profile(
            stock(),
            TurningToolKind::Turning,
            TurningQualityPreset::Balanced,
            1_779_033_703,
            4_500.0,
            20.0,
            &snapshot,
        )
        .expect("snapshot restores");
        assert_eq!(
            engine.profile_hash_sha256().expect("original hash"),
            restored.profile_hash_sha256().expect("restored hash")
        );
        assert_eq!(
            restored
                .detect_restricted_zone_collision(-1.0, 0.0)
                .expect("collision query")
                .expect("opposite-side collision")
                .kind,
            TurningCollisionKind::AxisOppositeSide
        );
        assert_eq!(
            restored
                .detect_restricted_zone_collision(20.0, -50.0)
                .expect("collision query")
                .expect("chuck collision")
                .kind,
            TurningCollisionKind::Chuck
        );
    }

    #[test]
    fn spindle_modes_match_golden_formula_and_clamp() {
        let g96 = resolve_lathe_spindle_speed(
            LatheSpindleMode::SurfaceSpeed,
            100.0,
            10.0,
            4_500.0,
            6_000.0,
        )
        .expect("valid G96");
        assert!((g96.requested_rpm - 3_183.098_861_837_907).abs() < 1e-12);
        assert!(!g96.clamped);
        let clamped = resolve_lathe_spindle_speed(
            LatheSpindleMode::SurfaceSpeed,
            200.0,
            10.0,
            4_500.0,
            6_000.0,
        )
        .expect("valid clamped G96");
        assert_eq!(clamped.effective_rpm, 4_500.0);
        assert!(clamped.clamped);
    }
}
