use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::PI;

use cnc_render_contracts::domain::{
    ArcPlane, CoordinateSystem, SourceLineMapEntry, SpindleMode as IrSpindleMode, ToolpathFeedMode,
    ToolpathIr, ToolpathSegment, Vec3Mm,
};
use cnc_render_contracts::{SCHEMA_VERSION, canonical_json};
use sha2::{Digest, Sha256};

use crate::block_parser::parse_blocks_with_limits;
use crate::geometry::{
    arc_length, center_from_radius, distance, offset_from_plane, radius_matches,
};
use crate::lexer::lex_with_limits;
use crate::limits::{GcodeResourceLimits, push_diagnostic_with_limit};
use crate::model::{
    CanonicalMotion, CoolantState, DIALECT, Diagnostic, DiagnosticSeverity, DistanceMode, FeedMode,
    FinalModalState, MotionMode, ParseOptions, ParseResult, PathLengthMm, Plane, ProgramControl,
    ProgramControlEvent, ProgramEnd, ReturnMode, RotaryPositionRad, SpindleMode, SpindleState,
    UnitMode, Word,
};

const PECK_CLEARANCE_MM: f64 = 0.254;
const MAX_CYCLE_EXPANSIONS: u64 = 100_000;

#[derive(Debug, Clone, Copy)]
enum ProgrammedCycleR {
    AbsoluteWorkMm(f64),
    IncrementalResolvedMm(f64),
}

impl ProgrammedCycleR {
    fn value_mm(self) -> f64 {
        match self {
            Self::AbsoluteWorkMm(value) | Self::IncrementalResolvedMm(value) => value,
        }
    }

    fn resolve(self, absolute_offset_mm: f64) -> f64 {
        match self {
            Self::AbsoluteWorkMm(value) => value + absolute_offset_mm,
            Self::IncrementalResolvedMm(value) => value,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum ProgrammedCycleDepth {
    AbsoluteWorkMm(f64),
    IncrementalFromRDeltaMm(f64),
}

impl ProgrammedCycleDepth {
    fn value_mm(self) -> f64 {
        match self {
            Self::AbsoluteWorkMm(value) | Self::IncrementalFromRDeltaMm(value) => value,
        }
    }

    fn resolve(self, r_plane_mm: f64, absolute_offset_mm: f64) -> f64 {
        match self {
            Self::AbsoluteWorkMm(value) => value + absolute_offset_mm,
            Self::IncrementalFromRDeltaMm(delta) => r_plane_mm + delta,
        }
    }
}

#[derive(Debug, Clone)]
struct CycleState {
    initial_plane_mm: f64,
    programmed_r: Option<ProgrammedCycleR>,
    programmed_depth: Option<ProgrammedCycleDepth>,
    depth_mm: Option<f64>,
    r_plane_mm: Option<f64>,
    peck_mm: Option<f64>,
    dwell_s: Option<f64>,
}

#[derive(Debug, Clone)]
struct ModalState {
    position_mm: Vec3Mm,
    rotary_rad: RotaryPositionRad,
    motion_mode: MotionMode,
    plane: Plane,
    distance_mode: DistanceMode,
    unit_mode: UnitMode,
    feed_mode: FeedMode,
    spindle_mode: SpindleMode,
    spindle_state: SpindleState,
    coolant_state: CoolantState,
    return_mode: ReturnMode,
    work_coordinate: String,
    selected_tool: Option<u32>,
    active_tool_length_offset: Option<u32>,
    feed_value: Option<f64>,
    spindle_value: Option<f64>,
    cycle: Option<CycleState>,
    program_end: ProgramEnd,
    last_program_control: ProgramControl,
}

impl ModalState {
    fn new(options: &ParseOptions) -> Self {
        Self {
            position_mm: normalized_vec(&options.initial_state.position_mm),
            rotary_rad: normalized_rotary(options.initial_state.rotary_rad),
            motion_mode: MotionMode::None,
            plane: Plane::Xy,
            distance_mode: DistanceMode::Absolute,
            unit_mode: UnitMode::Millimeter,
            feed_mode: FeedMode::UnitsPerMinute,
            spindle_mode: SpindleMode::Rpm,
            spindle_state: SpindleState::Off,
            coolant_state: CoolantState::Off,
            return_mode: ReturnMode::InitialPlane,
            work_coordinate: "g54".to_owned(),
            selected_tool: None,
            active_tool_length_offset: None,
            feed_value: None,
            spindle_value: None,
            cycle: None,
            program_end: ProgramEnd::None,
            last_program_control: ProgramControl::None,
        }
    }

    fn unit_scale(&self) -> f64 {
        match self.unit_mode {
            UnitMode::Millimeter => 1.0,
            UnitMode::Inch => 25.4,
        }
    }

    fn numbers_are_finite(&self) -> bool {
        vec_is_wire_safe(&self.position_mm)
            && rotary_is_wire_safe(&self.rotary_rad)
            && self.feed_value.is_none_or(number_is_wire_safe)
            && self.spindle_value.is_none_or(number_is_wire_safe)
            && self.cycle.as_ref().is_none_or(|cycle| {
                number_is_wire_safe(cycle.initial_plane_mm)
                    && cycle
                        .programmed_r
                        .is_none_or(|r_plane| number_is_wire_safe(r_plane.value_mm()))
                    && cycle
                        .programmed_depth
                        .is_none_or(|depth| number_is_wire_safe(depth.value_mm()))
                    && cycle.depth_mm.is_none_or(number_is_wire_safe)
                    && cycle.r_plane_mm.is_none_or(number_is_wire_safe)
                    && cycle.peck_mm.is_none_or(number_is_wire_safe)
                    && cycle.dwell_s.is_none_or(number_is_wire_safe)
            })
    }

    fn safe_initial(options: &ParseOptions) -> Self {
        let mut state = Self::new(options);
        if !vec_is_wire_safe(&state.position_mm) {
            state.position_mm = Vec3Mm {
                x_mm: 0.0,
                y_mm: 0.0,
                z_mm: 0.0,
            };
        }
        if !rotary_is_wire_safe(&state.rotary_rad) {
            state.rotary_rad = RotaryPositionRad::default();
        }
        state
    }

    fn final_state(&self) -> FinalModalState {
        FinalModalState {
            position_mm: self.position_mm.clone(),
            rotary_rad: self.rotary_rad,
            motion_mode: self.motion_mode,
            plane: self.plane,
            distance_mode: self.distance_mode,
            unit_mode: self.unit_mode,
            feed_mode: self.feed_mode,
            spindle_mode: self.spindle_mode,
            spindle_state: self.spindle_state,
            coolant_state: self.coolant_state,
            return_mode: self.return_mode,
            work_coordinate: self.work_coordinate.clone(),
            selected_tool: self.selected_tool,
            active_tool_length_offset: self.active_tool_length_offset,
            cutter_compensation_active: false,
            program_end: self.program_end,
            last_program_control: self.last_program_control,
        }
    }
}

pub fn compile(source: &str, options: &ParseOptions) -> ParseResult {
    compile_with_limits(source, options, GcodeResourceLimits::default())
}

fn compile_with_limits(
    source: &str,
    options: &ParseOptions,
    limits: GcodeResourceLimits,
) -> ParseResult {
    let lexer_output = lex_with_limits(source, limits);
    let parsed = parse_blocks_with_limits(&lexer_output, limits);
    let diagnostic_limit_reached = parsed
        .diagnostics
        .last()
        .is_some_and(is_terminal_resource_diagnostic);
    let first_parsed_fatal_line = parsed
        .diagnostics
        .iter()
        .filter(|diagnostic| {
            diagnostic.severity == DiagnosticSeverity::Error && !diagnostic.recoverable
        })
        .map(|diagnostic| diagnostic.line)
        .min();
    let mut engine = Engine {
        options,
        state: ModalState::new(options),
        diagnostics: parsed.diagnostics,
        motions: Vec::new(),
        control_events: Vec::new(),
        cycle_pecks_used: 0,
        limits,
        diagnostic_limit_reached,
    };
    if !engine.diagnostic_limit_reached {
        engine.validate_options();
    }
    for block in &parsed.blocks {
        if engine.diagnostic_limit_reached {
            break;
        }
        if engine.state.program_end != ProgramEnd::None
            || first_parsed_fatal_line.is_some_and(|line| block.source_line >= line)
        {
            engine.validate_nonexecuted_block_support(&block.words, block.source_line as usize);
            continue;
        }
        engine.process_block(&block.words, block.source_line as usize);
    }
    engine.finish(source)
}

struct Engine<'a> {
    options: &'a ParseOptions,
    state: ModalState,
    diagnostics: Vec<Diagnostic>,
    motions: Vec<CanonicalMotion>,
    control_events: Vec<ProgramControlEvent>,
    cycle_pecks_used: u64,
    limits: GcodeResourceLimits,
    diagnostic_limit_reached: bool,
}

impl Engine<'_> {
    fn validate_options(&mut self) {
        if self.diagnostic_limit_reached {
            return;
        }
        if !input_vec_is_wire_safe(&self.options.initial_state.position_mm)
            || !input_rotary_is_wire_safe(&self.options.initial_state.rotary_rad)
        {
            self.error(
                1,
                1,
                "semantic.numeric.non_finite",
                false,
                "initialState coordinates must be finite canonical wire numbers",
            );
        }
        let initial_rotary = &self.options.initial_state.rotary_rad;
        if input_rotary_is_wire_safe(initial_rotary)
            && (initial_rotary.a_rad != 0.0
                || initial_rotary.b_rad != 0.0
                || initial_rotary.c_rad != 0.0)
        {
            self.error(
                1,
                1,
                "semantic.rotary.not_lowered",
                false,
                "non-zero initial rotary state cannot be lowered to the XYZ-only ToolpathIr",
            );
        }
        for (number, length) in &self.options.tool_length_offsets_mm {
            if self.diagnostic_limit_reached {
                return;
            }
            if !input_number_is_wire_safe(*length) {
                self.error(
                    1,
                    1,
                    "semantic.numeric.non_finite",
                    false,
                    format!("toolLengthOffsetsMm[{number}] must be finite"),
                );
            }
        }
        let mut normalized_offsets = BTreeSet::new();
        for (key, offset) in &self.options.work_offsets_mm {
            if self.diagnostic_limit_reached {
                return;
            }
            if !normalized_offsets.insert(key.to_ascii_lowercase()) {
                self.error(
                    1,
                    1,
                    "request.work_offset.invalid",
                    false,
                    format!("duplicate case-insensitive work offset key '{key}'"),
                );
            }
            if !input_vec_is_wire_safe(offset) {
                self.error(
                    1,
                    1,
                    "semantic.numeric.non_finite",
                    false,
                    format!("work offset '{key}' must contain finite coordinates"),
                );
            }
        }
        if self.options.dialect != DIALECT {
            self.error(
                1,
                1,
                "request.dialect.unsupported",
                false,
                format!(
                    "dialect '{}' is not supported; expected {DIALECT}",
                    self.options.dialect
                ),
            );
        }
        if !is_uuid(&self.options.operation_id) {
            self.error(
                1,
                1,
                "request.uuid.invalid",
                false,
                "operationId must be an RFC 9562 UUID",
            );
        }
        if let Some(id) = &self.options.toolpath_id
            && !is_uuid(id)
        {
            self.error(
                1,
                1,
                "request.uuid.invalid",
                false,
                "toolpathId must be an RFC 9562 UUID",
            );
        }
        for (number, id) in &self.options.tool_numbers {
            if self.diagnostic_limit_reached {
                return;
            }
            if !is_uuid(id) {
                self.error(
                    1,
                    1,
                    "request.uuid.invalid",
                    false,
                    format!("toolNumbers[{number}] must be an RFC 9562 UUID"),
                );
            }
        }
        for key in self.options.work_offsets_mm.keys() {
            if self.diagnostic_limit_reached {
                return;
            }
            if !matches!(
                key.to_ascii_lowercase().as_str(),
                "g54" | "g55" | "g56" | "g57" | "g58" | "g59"
            ) {
                self.error(
                    1,
                    1,
                    "request.work_offset.invalid",
                    false,
                    format!("unknown work offset key '{key}'"),
                );
            }
        }
    }

    fn process_block(&mut self, words: &[Word], line: usize) {
        let state_checkpoint = self.state.clone();
        let motion_checkpoint = self.motions.len();
        let control_checkpoint = self.control_events.len();
        let cycle_pecks_checkpoint = self.cycle_pecks_used;
        let diagnostic_checkpoint = self.diagnostics.len();
        self.process_block_inner(words, line);
        let already_failed = self.diagnostics[diagnostic_checkpoint..]
            .iter()
            .any(|diagnostic| {
                diagnostic.severity == DiagnosticSeverity::Error && !diagnostic.recoverable
            });
        if !already_failed
            && (!self.state.numbers_are_finite()
                || !self.motions[motion_checkpoint..]
                    .iter()
                    .all(motion_numbers_are_finite))
        {
            self.error(
                line,
                1,
                "semantic.numeric.non_finite",
                false,
                "block arithmetic produced a non-finite canonical value",
            );
        }
        let block_failed = self.diagnostics[diagnostic_checkpoint..]
            .iter()
            .any(|diagnostic| {
                diagnostic.severity == DiagnosticSeverity::Error && !diagnostic.recoverable
            });
        if block_failed {
            self.state = state_checkpoint;
            self.motions.truncate(motion_checkpoint);
            self.control_events.truncate(control_checkpoint);
            self.cycle_pecks_used = cycle_pecks_checkpoint;
        }
    }

    fn process_block_inner(&mut self, words: &[Word], line: usize) {
        let diagnostic_start = self.diagnostics.len();
        self.validate_word_letters(words);
        if self.diagnostic_limit_reached {
            return;
        }
        let g_words: Vec<&Word> = words.iter().filter(|word| word.letter == 'G').collect();
        let mut motion_g = None;
        let mut modal_groups: BTreeMap<&'static str, i32> = BTreeMap::new();
        for word in g_words {
            if self.diagnostic_limit_reached {
                return;
            }
            let Some(code) = integer_code(word) else {
                self.error(
                    line,
                    word.column as usize,
                    "parser.gcode.unsupported",
                    false,
                    format!("{} is outside the common-v1 subset", word.raw),
                );
                continue;
            };
            let Some(group) = g_modal_group(code) else {
                self.error(
                    line,
                    word.column as usize,
                    "parser.gcode.unsupported",
                    false,
                    format!("G{code} is outside the common-v1 subset"),
                );
                continue;
            };
            if let Some(previous) = modal_groups.insert(group, code)
                && previous != code
            {
                self.error(
                    line,
                    word.column as usize,
                    "parser.modal.conflict",
                    false,
                    format!("G{previous} and G{code} belong to the same modal group"),
                );
                continue;
            }
            if group == "motion" {
                motion_g = Some(code);
            }
        }

        if self.diagnostic_limit_reached {
            return;
        }
        for (group, code) in &modal_groups {
            if self.diagnostic_limit_reached {
                return;
            }
            if *group != "motion" {
                self.apply_g_mode(*code, line, words);
            }
        }
        if let Some(code) = motion_g {
            self.apply_motion_mode(code, line, words);
        }
        if self.diagnostics[diagnostic_start..]
            .iter()
            .any(|diagnostic| {
                diagnostic.severity == DiagnosticSeverity::Error && !diagnostic.recoverable
            })
        {
            return;
        }
        if !self.validate_context_words(words, line) {
            return;
        }

        let explicit_g96 = modal_groups.get("spindle") == Some(&96);
        self.apply_value_words(words, line, explicit_g96);
        self.apply_m_codes(words, line);
        if self.diagnostic_limit_reached {
            return;
        }

        let has_axis = words
            .iter()
            .any(|word| matches!(word.letter, 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'));
        let has_arc_center = words
            .iter()
            .any(|word| matches!(word.letter, 'I' | 'J' | 'K' | 'R'));
        let has_rotary = words
            .iter()
            .any(|word| matches!(word.letter, 'A' | 'B' | 'C'));
        if has_rotary {
            self.error(
                line,
                first_rotary_column(words),
                "semantic.rotary.not_lowered",
                false,
                "A/B/C motion is recognized but unsupported by the XYZ-only ToolpathIr",
            );
            return;
        }
        let explicit_cycle = matches!(motion_g, Some(81..=83));
        let has_cycle_parameter = words
            .iter()
            .any(|word| matches!(word.letter, 'R' | 'P' | 'Q'));
        match self.state.motion_mode {
            MotionMode::Cycle81 | MotionMode::Cycle82 | MotionMode::Cycle83
                if has_axis || explicit_cycle =>
            {
                self.expand_cycle(words, line);
            }
            MotionMode::Cycle81 | MotionMode::Cycle82 | MotionMode::Cycle83
                if has_cycle_parameter =>
            {
                self.update_cycle_parameters(words, line);
            }
            MotionMode::Rapid | MotionMode::Linear if has_axis => {
                self.emit_straight(words, line);
            }
            MotionMode::ArcClockwise | MotionMode::ArcCounterclockwise
                if has_axis || has_arc_center =>
            {
                self.emit_arc(words, line);
            }
            MotionMode::None if has_axis => self.error(
                line,
                first_axis_column(words),
                "semantic.motion.missing",
                false,
                "axis words require an explicit or previously active motion mode",
            ),
            _ => {}
        }
    }

    fn validate_context_words(&mut self, words: &[Word], line: usize) -> bool {
        let g43_in_block = words
            .iter()
            .any(|word| word.letter == 'G' && integer_code(word) == Some(43));
        for word in words {
            let valid = match word.letter {
                'H' => g43_in_block,
                'I' | 'J' | 'K' => match self.state.motion_mode {
                    MotionMode::ArcClockwise | MotionMode::ArcCounterclockwise => {
                        match self.state.plane {
                            Plane::Xy => matches!(word.letter, 'I' | 'J'),
                            Plane::Xz => matches!(word.letter, 'I' | 'K'),
                            Plane::Yz => matches!(word.letter, 'J' | 'K'),
                        }
                    }
                    _ => false,
                },
                'R' => matches!(
                    self.state.motion_mode,
                    MotionMode::ArcClockwise
                        | MotionMode::ArcCounterclockwise
                        | MotionMode::Cycle81
                        | MotionMode::Cycle82
                        | MotionMode::Cycle83
                ),
                'P' if matches!(
                    self.state.motion_mode,
                    MotionMode::ArcClockwise | MotionMode::ArcCounterclockwise
                ) =>
                {
                    self.error(
                        line,
                        word.column as usize,
                        "semantic.arc.turns.unsupported",
                        false,
                        "arc P multi-turn count is recognized but unsupported",
                    );
                    return false;
                }
                'P' => self.state.motion_mode == MotionMode::Cycle82,
                'Q' => self.state.motion_mode == MotionMode::Cycle83,
                _ => true,
            };
            if !valid {
                self.error(
                    line,
                    word.column as usize,
                    "semantic.word.context",
                    false,
                    format!(
                        "word {} is not valid in the active motion context",
                        word.letter
                    ),
                );
                return false;
            }
        }
        true
    }

    fn validate_nonexecuted_block_support(&mut self, words: &[Word], line: usize) {
        self.validate_word_letters(words);
        if self.diagnostic_limit_reached {
            return;
        }

        let mut g_modal_groups: BTreeMap<&'static str, i32> = BTreeMap::new();
        let mut m_modal_groups = BTreeSet::new();
        let mut explicit_motion_g = None;
        let mut g_validation_failed = false;
        let mut rotary_reported = false;
        for word in words {
            if self.diagnostic_limit_reached {
                return;
            }
            match word.letter {
                'G' => {
                    let Some(code) = integer_code(word) else {
                        g_validation_failed = true;
                        self.error(
                            line,
                            word.column as usize,
                            "parser.gcode.unsupported",
                            false,
                            format!("{} is outside the common-v1 subset", word.raw),
                        );
                        continue;
                    };
                    let Some(group) = g_modal_group(code) else {
                        g_validation_failed = true;
                        self.error(
                            line,
                            word.column as usize,
                            "parser.gcode.unsupported",
                            false,
                            format!("G{code} is outside the common-v1 subset"),
                        );
                        continue;
                    };
                    if let Some(previous) = g_modal_groups.insert(group, code)
                        && previous != code
                    {
                        g_validation_failed = true;
                        self.error(
                            line,
                            word.column as usize,
                            "parser.modal.conflict",
                            false,
                            format!("G{previous} and G{code} belong to the same modal group"),
                        );
                        continue;
                    }
                    if group == "motion" {
                        explicit_motion_g = Some(code);
                    }
                    if matches!(code, 41 | 42) {
                        g_validation_failed = true;
                        self.error(
                            line,
                            word.column as usize,
                            "semantic.cutter_comp.unsupported",
                            false,
                            format!(
                                "G{code} cutter radius compensation is recognized but unsupported"
                            ),
                        );
                    } else if matches!(code, 84..=89) {
                        g_validation_failed = true;
                        self.error(
                            line,
                            word.column as usize,
                            "parser.gcode.unsupported",
                            false,
                            format!("G{code} is recognized but unsupported"),
                        );
                    }
                }
                'M' => {
                    let Some(code) = integer_code(word) else {
                        self.error(
                            line,
                            word.column as usize,
                            "parser.mcode.unsupported",
                            false,
                            format!("{} is outside the common-v1 subset", word.raw),
                        );
                        continue;
                    };
                    let group = match code {
                        3..=5 => "spindle",
                        8 | 9 => "coolant",
                        0..=2 | 30 => "program",
                        6 => "tool",
                        _ => {
                            self.error(
                                line,
                                word.column as usize,
                                "parser.mcode.unsupported",
                                false,
                                format!("M{code} is outside the common-v1 subset"),
                            );
                            continue;
                        }
                    };
                    if !m_modal_groups.insert(group) {
                        self.error(
                            line,
                            word.column as usize,
                            "parser.modal.conflict",
                            false,
                            format!("multiple M codes from the {group} group occur in one block"),
                        );
                    }
                }
                'A' | 'B' | 'C' if !rotary_reported => {
                    rotary_reported = true;
                    self.error(
                        line,
                        word.column as usize,
                        "semantic.rotary.not_lowered",
                        false,
                        "A/B/C motion is recognized but unsupported by the XYZ-only ToolpathIr",
                    );
                }
                _ => {}
            }
        }

        let explicit_arc = matches!(explicit_motion_g, Some(2 | 3));
        let inherited_arc = explicit_motion_g.is_none()
            && self.state.program_end != ProgramEnd::None
            && matches!(
                self.state.motion_mode,
                MotionMode::ArcClockwise | MotionMode::ArcCounterclockwise
            );
        if !g_validation_failed
            && (explicit_arc || inherited_arc)
            && let Some(p_word) = words.iter().find(|word| word.letter == 'P')
        {
            self.error(
                line,
                p_word.column as usize,
                "semantic.arc.turns.unsupported",
                false,
                "arc P multi-turn count is recognized but unsupported",
            );
        }
    }
    fn validate_word_letters(&mut self, words: &[Word]) {
        const KNOWN: &str = "GMTSFXYZABCIJKRPQH";
        for word in words {
            if self.diagnostic_limit_reached {
                return;
            }
            if !KNOWN.contains(word.letter) {
                self.error(
                    word.line as usize,
                    word.column as usize,
                    "parser.word.unsupported",
                    false,
                    format!("word {} is outside the common-v1 subset", word.letter),
                );
            }
        }
    }

    fn apply_g_mode(&mut self, code: i32, line: usize, words: &[Word]) {
        match code {
            17 => self.apply_plane(Plane::Xy, code, line, words),
            18 => self.apply_plane(Plane::Xz, code, line, words),
            19 => self.apply_plane(Plane::Yz, code, line, words),
            20 => self.state.unit_mode = UnitMode::Inch,
            21 => self.state.unit_mode = UnitMode::Millimeter,
            40 => {}
            41 | 42 => self.error(
                line,
                code_column(words, 'G', code),
                "semantic.cutter_comp.unsupported",
                false,
                format!("G{code} cutter radius compensation is recognized but unsupported"),
            ),
            43 => {
                let Some(h_word) = words.iter().find(|word| word.letter == 'H') else {
                    self.error(
                        line,
                        code_column(words, 'G', code),
                        "semantic.tool_length.missing_h",
                        false,
                        "G43 requires a positive integer H offset",
                    );
                    return;
                };
                let Some(h) = positive_u32_word(h_word) else {
                    self.error(
                        line,
                        h_word.column as usize,
                        "semantic.tool_length.missing_h",
                        false,
                        "G43 requires a positive integer H offset",
                    );
                    return;
                };
                if !self.options.tool_length_offsets_mm.contains_key(&h) {
                    self.error(
                        line,
                        h_word.column as usize,
                        "semantic.tool_length.unmapped",
                        false,
                        format!("H{h} has no toolLengthOffsetsMm mapping"),
                    );
                } else {
                    self.state.active_tool_length_offset = Some(h);
                }
            }
            49 => self.state.active_tool_length_offset = None,
            54..=59 => self.state.work_coordinate = format!("g{code}"),
            90 => self.state.distance_mode = DistanceMode::Absolute,
            91 => self.state.distance_mode = DistanceMode::Incremental,
            94 => {
                if self.state.feed_mode != FeedMode::UnitsPerMinute {
                    self.state.feed_value = None;
                }
                self.state.feed_mode = FeedMode::UnitsPerMinute;
            }
            95 => {
                if self.state.feed_mode != FeedMode::UnitsPerRevolution {
                    self.state.feed_value = None;
                }
                self.state.feed_mode = FeedMode::UnitsPerRevolution;
            }
            96 => {
                if self.state.spindle_mode != SpindleMode::SurfaceSpeed {
                    self.state.spindle_value = None;
                }
                self.state.spindle_mode = SpindleMode::SurfaceSpeed;
            }
            97 => {
                if self.state.spindle_mode != SpindleMode::Rpm {
                    self.state.spindle_value = None;
                }
                self.state.spindle_mode = SpindleMode::Rpm;
            }
            98 => self.state.return_mode = ReturnMode::InitialPlane,
            99 => self.state.return_mode = ReturnMode::RPlane,
            _ => {}
        }
    }

    fn apply_plane(&mut self, plane: Plane, code: i32, line: usize, words: &[Word]) {
        let cycle_active = matches!(
            self.state.motion_mode,
            MotionMode::Cycle81 | MotionMode::Cycle82 | MotionMode::Cycle83
        );
        if cycle_active && self.state.plane != plane {
            self.error(
                line,
                code_column(words, 'G', code),
                "semantic.cycle.plane_change",
                false,
                "active canned cycle must be cancelled with G80 before changing plane",
            );
            return;
        }
        self.state.plane = plane;
    }

    fn apply_motion_mode(&mut self, code: i32, line: usize, words: &[Word]) {
        match code {
            0 => {
                self.state.motion_mode = MotionMode::Rapid;
                self.state.cycle = None;
            }
            1 => {
                self.state.motion_mode = MotionMode::Linear;
                self.state.cycle = None;
            }
            2 => {
                self.state.motion_mode = MotionMode::ArcClockwise;
                self.state.cycle = None;
            }
            3 => {
                self.state.motion_mode = MotionMode::ArcCounterclockwise;
                self.state.cycle = None;
            }
            80 => {
                self.state.motion_mode = MotionMode::None;
                self.state.cycle = None;
            }
            81..=83 => {
                if self.state.cycle.is_none() {
                    self.state.cycle = Some(CycleState {
                        initial_plane_mm: drill_value(&self.state.position_mm, self.state.plane),
                        programmed_r: None,
                        programmed_depth: None,
                        depth_mm: None,
                        r_plane_mm: None,
                        peck_mm: None,
                        dwell_s: None,
                    });
                }
                self.state.motion_mode = match code {
                    81 => MotionMode::Cycle81,
                    82 => MotionMode::Cycle82,
                    _ => MotionMode::Cycle83,
                };
            }
            84..=89 => self.error(
                line,
                code_column(words, 'G', code),
                "parser.gcode.unsupported",
                false,
                format!("G{code} is recognized but unsupported"),
            ),
            _ => {}
        }
    }

    fn apply_value_words(&mut self, words: &[Word], line: usize, explicit_g96: bool) {
        if let Some(tool_word) = words.iter().find(|word| word.letter == 'T') {
            if let Some(number) = positive_u32_word(tool_word) {
                self.state.selected_tool = Some(number);
            } else {
                self.error(
                    line,
                    tool_word.column as usize,
                    "semantic.tool.invalid",
                    false,
                    "T must be a positive integer",
                );
            }
        }
        if let Some(feed) = word_value(words, 'F') {
            if feed <= 0.0 {
                self.error(
                    line,
                    column_of(words, 'F'),
                    "semantic.feed.non_positive",
                    false,
                    "F must be greater than zero",
                );
            } else {
                self.state.feed_value = Some(feed * self.state.unit_scale());
            }
        }
        if let Some(speed) = word_value(words, 'S') {
            if speed <= 0.0 {
                self.error(
                    line,
                    column_of(words, 'S'),
                    "semantic.spindle.non_positive",
                    false,
                    "S must be greater than zero",
                );
            } else {
                self.state.spindle_value =
                    Some(match (self.state.spindle_mode, self.state.unit_mode) {
                        (SpindleMode::SurfaceSpeed, UnitMode::Millimeter) => speed * 1_000.0,
                        (SpindleMode::SurfaceSpeed, UnitMode::Inch) => speed * 304.8,
                        (SpindleMode::Rpm, _) => speed,
                    });
            }
        }
        if explicit_g96 && word_value(words, 'S').is_none() {
            self.error(
                line,
                code_column(words, 'G', 96),
                "semantic.spindle.missing",
                false,
                "G96 requires a positive S surface speed",
            );
        }
    }

    fn apply_m_codes(&mut self, words: &[Word], line: usize) {
        let mut groups = BTreeSet::new();
        for word in words.iter().filter(|word| word.letter == 'M') {
            if self.diagnostic_limit_reached {
                return;
            }
            let Some(code) = integer_code(word) else {
                self.error(
                    line,
                    word.column as usize,
                    "parser.mcode.unsupported",
                    false,
                    format!("{} is outside the common-v1 subset", word.raw),
                );
                continue;
            };
            let group = match code {
                3..=5 => "spindle",
                8 | 9 => "coolant",
                0..=2 | 30 => "program",
                6 => "tool",
                _ => {
                    self.error(
                        line,
                        word.column as usize,
                        "parser.mcode.unsupported",
                        false,
                        format!("M{code} is outside the common-v1 subset"),
                    );
                    continue;
                }
            };
            if !groups.insert(group) {
                self.error(
                    line,
                    word.column as usize,
                    "parser.modal.conflict",
                    false,
                    format!("multiple M codes from the {group} group occur in one block"),
                );
                continue;
            }
            match code {
                3 => self.state.spindle_state = SpindleState::Clockwise,
                4 => self.state.spindle_state = SpindleState::Counterclockwise,
                5 => self.state.spindle_state = SpindleState::Off,
                6 => self.emit_tool_change(line, word.column as usize),
                8 => self.state.coolant_state = CoolantState::Flood,
                9 => self.state.coolant_state = CoolantState::Off,
                0 => {
                    self.state.last_program_control = ProgramControl::M0;
                    self.control_events.push(ProgramControlEvent {
                        source_line: line as u64,
                        control: ProgramControl::M0,
                    });
                }
                1 => {
                    self.state.last_program_control = ProgramControl::M1;
                    self.control_events.push(ProgramControlEvent {
                        source_line: line as u64,
                        control: ProgramControl::M1,
                    });
                }
                2 => {
                    self.state.program_end = ProgramEnd::M2;
                    self.state.last_program_control = ProgramControl::M2;
                    self.control_events.push(ProgramControlEvent {
                        source_line: line as u64,
                        control: ProgramControl::M2,
                    });
                }
                30 => {
                    self.state.program_end = ProgramEnd::M30;
                    self.state.last_program_control = ProgramControl::M30;
                    self.control_events.push(ProgramControlEvent {
                        source_line: line as u64,
                        control: ProgramControl::M30,
                    });
                }
                _ => {}
            }
        }
    }

    fn emit_tool_change(&mut self, line: usize, column: usize) {
        let Some(number) = self.state.selected_tool else {
            self.error(
                line,
                column,
                "semantic.tool.not_selected",
                false,
                "M6 requires a selected T word",
            );
            return;
        };
        let Some(id) = self.options.tool_numbers.get(&number) else {
            self.error(
                line,
                column,
                "semantic.tool.unmapped",
                false,
                format!("T{number} has no toolNumbers mapping"),
            );
            return;
        };
        self.push_motion(
            CanonicalMotion::ToolChange {
                source_line: line as u64,
                position_mm: self.state.position_mm.clone(),
                tool_assembly_id: id.clone(),
            },
            line,
        );
    }

    fn emit_straight(&mut self, words: &[Word], line: usize) {
        let start = self.state.position_mm.clone();
        let start_rotary = self.state.rotary_rad;
        let end = self.target_position(words);
        let end_rotary = self.state.rotary_rad;
        let motion = match self.state.motion_mode {
            MotionMode::Rapid => CanonicalMotion::Rapid {
                source_line: line as u64,
                start_mm: start,
                end_mm: end.clone(),
                start_rotary_rad: start_rotary,
                end_rotary_rad: end_rotary,
            },
            MotionMode::Linear => {
                let Some(feed) = self.resolve_feed(&end, line) else {
                    return;
                };
                CanonicalMotion::Linear {
                    source_line: line as u64,
                    start_mm: start,
                    end_mm: end.clone(),
                    start_rotary_rad: start_rotary,
                    end_rotary_rad: end_rotary,
                    feed_mm_per_min: feed,
                }
            }
            _ => return,
        };
        if !self.push_motion(motion, line) {
            return;
        }
        self.state.position_mm = end;
        self.state.rotary_rad = end_rotary;
    }

    fn emit_arc(&mut self, words: &[Word], line: usize) {
        let start = self.state.position_mm.clone();
        let end = self.target_position(words);
        let clockwise = self.state.motion_mode == MotionMode::ArcClockwise;
        let Some(feed) = self.resolve_feed(&end, line) else {
            return;
        };
        let radius_word = word_value(words, 'R');
        let offset_words = ['I', 'J', 'K']
            .into_iter()
            .any(|letter| word_value(words, letter).is_some());
        if radius_word.is_some() && offset_words {
            self.error(
                line,
                column_of(words, 'R'),
                "semantic.arc.center_conflict",
                false,
                "arc must use either R or IJK, not both",
            );
            return;
        }
        let center_offset = if let Some(radius) = radius_word {
            match center_from_radius(
                &start,
                &end,
                self.state.plane,
                radius * self.state.unit_scale(),
                clockwise,
            ) {
                Ok(center) => center,
                Err("full-circle radius arcs are ambiguous") => {
                    self.error(
                        line,
                        column_of(words, 'R'),
                        "semantic.arc.full_circle_r_unsupported",
                        false,
                        "full-circle R arcs are ambiguous; use IJK",
                    );
                    return;
                }
                Err(message) => {
                    self.error(
                        line,
                        column_of(words, 'R'),
                        "semantic.arc.invalid_radius",
                        false,
                        message,
                    );
                    return;
                }
            }
        } else {
            let scale = self.state.unit_scale();
            let (u, v) = match self.state.plane {
                Plane::Xy => (word_value(words, 'I'), word_value(words, 'J')),
                Plane::Xz => (word_value(words, 'K'), word_value(words, 'I')),
                Plane::Yz => (word_value(words, 'J'), word_value(words, 'K')),
            };
            if u.is_none() && v.is_none() {
                self.error(
                    line,
                    1,
                    "semantic.arc.missing_center",
                    false,
                    "IJK arc requires at least one center offset for the active plane",
                );
                return;
            }
            offset_from_plane(
                u.unwrap_or(0.0) * scale,
                v.unwrap_or(0.0) * scale,
                self.state.plane,
            )
        };
        let center_offset = normalized_vec(&center_offset);
        if !radius_matches(
            &start,
            &end,
            &center_offset,
            self.state.plane,
            self.state.unit_mode,
        ) {
            self.error(
                line,
                1,
                "semantic.arc.radius_mismatch",
                false,
                "arc start and end radii do not match",
            );
            return;
        }
        if !self.push_motion(
            CanonicalMotion::Arc {
                source_line: line as u64,
                start_mm: start,
                end_mm: end.clone(),
                center_offset_mm: center_offset,
                plane: self.state.plane,
                clockwise,
                feed_mm_per_min: feed,
            },
            line,
        ) {
            return;
        }
        self.state.position_mm = end;
    }

    fn update_cycle_parameters(&mut self, words: &[Word], line: usize) -> Option<CycleState> {
        let plane = self.state.plane;
        let scale = self.state.unit_scale();
        let offset = self.work_offset();
        let distance_mode = self.state.distance_mode;
        let current_drill = drill_value(&self.state.position_mm, plane);
        let depth_word = drill_word(words, plane);
        let r_word = word_value(words, 'R');
        let q_word = word_value(words, 'Q');
        let p_word = word_value(words, 'P');

        let mut cycle = self.state.cycle.clone()?;
        let tool_length_mm = if plane == Plane::Xy {
            self.active_tool_length_mm()
        } else {
            0.0
        };
        let absolute_offset_mm = drill_value(&offset, plane) + tool_length_mm;
        if let Some(value) = r_word {
            cycle.programmed_r = Some(match distance_mode {
                DistanceMode::Absolute => {
                    ProgrammedCycleR::AbsoluteWorkMm(canonical_zero(value * scale))
                }
                DistanceMode::Incremental => ProgrammedCycleR::IncrementalResolvedMm(
                    canonical_zero(current_drill + value * scale),
                ),
            });
        }
        cycle.r_plane_mm = cycle
            .programmed_r
            .map(|programmed| canonical_zero(programmed.resolve(absolute_offset_mm)));
        if let Some(value) = depth_word {
            cycle.programmed_depth = Some(match distance_mode {
                DistanceMode::Absolute => {
                    ProgrammedCycleDepth::AbsoluteWorkMm(canonical_zero(value * scale))
                }
                DistanceMode::Incremental => {
                    ProgrammedCycleDepth::IncrementalFromRDeltaMm(canonical_zero(value * scale))
                }
            });
        }
        cycle.depth_mm = cycle.programmed_depth.and_then(|programmed| {
            cycle
                .r_plane_mm
                .map(|r_plane| canonical_zero(programmed.resolve(r_plane, absolute_offset_mm)))
        });
        if let Some(value) = q_word {
            cycle.peck_mm = Some(canonical_zero(value * scale));
        }
        if let Some(value) = p_word {
            cycle.dwell_s = Some(canonical_zero(value));
        }

        if !number_is_wire_safe(cycle.initial_plane_mm)
            || cycle
                .programmed_r
                .is_some_and(|r_plane| !number_is_wire_safe(r_plane.value_mm()))
            || cycle
                .programmed_depth
                .is_some_and(|depth| !number_is_wire_safe(depth.value_mm()))
            || cycle
                .depth_mm
                .is_some_and(|value| !number_is_wire_safe(value))
            || cycle
                .r_plane_mm
                .is_some_and(|value| !number_is_wire_safe(value))
            || cycle
                .peck_mm
                .is_some_and(|value| !number_is_wire_safe(value))
            || cycle
                .dwell_s
                .is_some_and(|value| !number_is_wire_safe(value))
        {
            self.error(
                line,
                1,
                "semantic.numeric.non_finite",
                false,
                "canned-cycle parameter arithmetic produced a non-finite value",
            );
            return None;
        }

        let (Some(depth), Some(r_plane)) = (cycle.depth_mm, cycle.r_plane_mm) else {
            self.error(
                line,
                1,
                "semantic.cycle.parameter_missing",
                false,
                "canned cycle requires sticky drilling-axis depth and R plane",
            );
            return None;
        };
        if depth >= r_plane {
            self.error(
                line,
                1,
                "semantic.cycle.invalid_parameter",
                false,
                "canned cycle depth must be below the R plane",
            );
            return None;
        }
        if self.state.motion_mode == MotionMode::Cycle82 {
            match cycle.dwell_s {
                None => {
                    self.error(
                        line,
                        column_of(words, 'P'),
                        "semantic.cycle.parameter_missing",
                        false,
                        "G82 requires a P dwell in seconds",
                    );
                    return None;
                }
                Some(value) if value <= 0.0 => {
                    self.error(
                        line,
                        column_of(words, 'P'),
                        "semantic.cycle.invalid_parameter",
                        false,
                        "G82 P dwell must be greater than zero",
                    );
                    return None;
                }
                Some(_) => {}
            }
        }
        if self.state.motion_mode == MotionMode::Cycle83 {
            match cycle.peck_mm {
                None => {
                    self.error(
                        line,
                        column_of(words, 'Q'),
                        "semantic.cycle.parameter_missing",
                        false,
                        "G83 requires a Q peck distance",
                    );
                    return None;
                }
                Some(value) if value <= 0.0 => {
                    self.error(
                        line,
                        column_of(words, 'Q'),
                        "semantic.cycle.invalid_parameter",
                        false,
                        "G83 Q peck distance must be greater than zero",
                    );
                    return None;
                }
                Some(_) => {}
            }
        }

        self.state.cycle = Some(cycle.clone());
        Some(cycle)
    }

    fn expand_cycle(&mut self, words: &[Word], line: usize) {
        let plane = self.state.plane;
        let current_drill = drill_value(&self.state.position_mm, plane);
        let Some(cycle) = self.update_cycle_parameters(words, line) else {
            return;
        };
        let (Some(depth), Some(r_plane)) = (cycle.depth_mm, cycle.r_plane_mm) else {
            return;
        };

        let requested_pecks = if self.state.motion_mode == MotionMode::Cycle83 {
            let peck = cycle.peck_mm.unwrap_or(0.0);
            let expansion_count = ((depth - r_plane).abs() / peck).ceil();
            if !expansion_count.is_finite() || expansion_count > MAX_CYCLE_EXPANSIONS as f64 {
                self.error(
                    line,
                    column_of(words, 'Q'),
                    "semantic.cycle.expansion_limit",
                    false,
                    "G83 expansion exceeds the deterministic parse-wide 100000-peck limit",
                );
                return;
            }
            let requested_pecks = (expansion_count as u64).max(1);
            let remaining_pecks = MAX_CYCLE_EXPANSIONS.saturating_sub(self.cycle_pecks_used);
            if requested_pecks > remaining_pecks {
                self.error(
                    line,
                    column_of(words, 'Q'),
                    "semantic.cycle.expansion_limit",
                    false,
                    "G83 expansion exceeds the deterministic parse-wide 100000-peck limit",
                );
                return;
            }
            Some(requested_pecks)
        } else {
            None
        };

        if current_drill < r_plane {
            let mut preliminary_r = self.state.position_mm.clone();
            set_drill_value(&mut preliminary_r, plane, r_plane);
            if !self.push_rapid(line, preliminary_r) {
                return;
            }
        }
        let mut parallel_target = self.target_position(words);
        set_drill_value(
            &mut parallel_target,
            plane,
            drill_value(&self.state.position_mm, plane),
        );
        if !self.push_rapid(line, parallel_target) {
            return;
        }
        let mut at_r = self.state.position_mm.clone();
        set_drill_value(&mut at_r, plane, r_plane);
        if !self.push_rapid(line, at_r) {
            return;
        }

        if let Some(requested_pecks) = requested_pecks {
            let peck = cycle.peck_mm.unwrap_or(0.0);
            let direction = if depth >= r_plane { 1.0 } else { -1.0 };
            let mut last_bottom = r_plane;
            for peck_index in 1..=requested_pecks {
                if self.cycle_pecks_used >= MAX_CYCLE_EXPANSIONS {
                    self.error(
                        line,
                        column_of(words, 'Q'),
                        "semantic.cycle.expansion_limit",
                        false,
                        "G83 expansion exceeds the deterministic parse-wide 100000-peck limit",
                    );
                    return;
                }
                self.cycle_pecks_used += 1;
                let next = if peck_index == requested_pecks {
                    depth
                } else {
                    let candidate = r_plane + direction * peck * peck_index as f64;
                    if direction > 0.0 {
                        candidate.min(depth)
                    } else {
                        candidate.max(depth)
                    }
                };
                if (next - last_bottom).abs() <= 1.0e-12 {
                    self.error(
                        line,
                        column_of(words, 'Q'),
                        "semantic.cycle.expansion_limit",
                        false,
                        "G83 peck does not make finite numeric progress",
                    );
                    return;
                }
                let mut bottom = self.state.position_mm.clone();
                set_drill_value(&mut bottom, plane, next);
                let Some(feed) = self.resolve_feed(&bottom, line) else {
                    return;
                };
                if !self.push_linear(line, bottom, feed) {
                    return;
                }
                last_bottom = next;
                if peck_index < requested_pecks {
                    let mut retract = self.state.position_mm.clone();
                    set_drill_value(&mut retract, plane, r_plane);
                    if !self.push_rapid(line, retract) {
                        return;
                    }
                    let approach_value = last_bottom - direction * PECK_CLEARANCE_MM;
                    let approach_value = if direction > 0.0 {
                        approach_value.max(r_plane)
                    } else {
                        approach_value.min(r_plane)
                    };
                    let mut approach = self.state.position_mm.clone();
                    set_drill_value(&mut approach, plane, approach_value);
                    if !self.push_rapid(line, approach) {
                        return;
                    }
                }
            }
        } else {
            let mut bottom = self.state.position_mm.clone();
            set_drill_value(&mut bottom, plane, depth);
            let Some(feed) = self.resolve_feed(&bottom, line) else {
                return;
            };
            if !self.push_linear(line, bottom, feed) {
                return;
            }
            if self.state.motion_mode == MotionMode::Cycle82
                && !self.push_motion(
                    CanonicalMotion::Dwell {
                        source_line: line as u64,
                        position_mm: self.state.position_mm.clone(),
                        duration_s: cycle.dwell_s.unwrap_or(0.0),
                    },
                    line,
                )
            {
                return;
            }
        }

        let return_value = match self.state.return_mode {
            ReturnMode::RPlane => r_plane,
            ReturnMode::InitialPlane if depth < r_plane => cycle.initial_plane_mm.max(r_plane),
            ReturnMode::InitialPlane => cycle.initial_plane_mm.min(r_plane),
        };
        let mut returned = self.state.position_mm.clone();
        set_drill_value(&mut returned, plane, return_value);
        self.push_rapid(line, returned);
    }

    fn push_motion(&mut self, motion: CanonicalMotion, line: usize) -> bool {
        if self.motions.len() >= self.limits.canonical_motions {
            self.error(
                line,
                1,
                "semantic.motion.limit",
                false,
                format!(
                    "canonical motion count exceeds the {} motion limit",
                    self.limits.canonical_motions
                ),
            );
            return false;
        }
        self.motions.push(motion);
        true
    }

    fn push_rapid(&mut self, line: usize, end: Vec3Mm) -> bool {
        let start = self.state.position_mm.clone();
        if distance(&start, &end) <= 1.0e-12 {
            return true;
        }
        if !self.push_motion(
            CanonicalMotion::Rapid {
                source_line: line as u64,
                start_mm: start,
                end_mm: end.clone(),
                start_rotary_rad: self.state.rotary_rad,
                end_rotary_rad: self.state.rotary_rad,
            },
            line,
        ) {
            return false;
        }
        self.state.position_mm = end;
        true
    }

    fn push_linear(&mut self, line: usize, end: Vec3Mm, feed: f64) -> bool {
        let start = self.state.position_mm.clone();
        if !self.push_motion(
            CanonicalMotion::Linear {
                source_line: line as u64,
                start_mm: start,
                end_mm: end.clone(),
                start_rotary_rad: self.state.rotary_rad,
                end_rotary_rad: self.state.rotary_rad,
                feed_mm_per_min: feed,
            },
            line,
        ) {
            return false;
        }
        self.state.position_mm = end;
        true
    }

    fn resolve_feed(&mut self, endpoint: &Vec3Mm, line: usize) -> Option<f64> {
        let Some(feed) = self.state.feed_value else {
            self.error(
                line,
                1,
                "semantic.feed.missing",
                false,
                "feed motion requires a positive F in the active feed mode",
            );
            return None;
        };
        let resolved = match self.state.feed_mode {
            FeedMode::UnitsPerMinute => feed,
            FeedMode::UnitsPerRevolution => {
                let Some(speed) = self.state.spindle_value else {
                    self.error(
                        line,
                        1,
                        "semantic.feed.unresolved_per_revolution",
                        false,
                        "G95 requires a positive spindle speed",
                    );
                    return None;
                };
                let rpm = match self.state.spindle_mode {
                    SpindleMode::Rpm => speed,
                    SpindleMode::SurfaceSpeed => {
                        let diameter = endpoint.x_mm.abs();
                        if diameter <= 1.0e-12 {
                            self.error(
                                line,
                                1,
                                "semantic.feed.unresolved_per_revolution",
                                false,
                                "G95/G96 requires a non-zero canonical X diameter",
                            );
                            return None;
                        }
                        speed / (PI * diameter)
                    }
                };
                feed * rpm
            }
        };
        if !resolved.is_finite() {
            self.error(
                line,
                1,
                "semantic.numeric.non_finite",
                false,
                "resolved canonical feed is not finite",
            );
            return None;
        }
        if resolved <= 0.0 {
            self.error(
                line,
                1,
                "semantic.feed.non_positive",
                false,
                "resolved canonical feed must remain greater than zero",
            );
            return None;
        }
        Some(canonical_zero(resolved))
    }

    fn target_position(&self, words: &[Word]) -> Vec3Mm {
        let offset = self.work_offset();
        let mut target = self.state.position_mm.clone();
        target.x_mm = target_axis(
            target.x_mm,
            word_value(words, 'X'),
            offset.x_mm,
            self.state.distance_mode,
            self.state.unit_scale(),
        );
        target.y_mm = target_axis(
            target.y_mm,
            word_value(words, 'Y'),
            offset.y_mm,
            self.state.distance_mode,
            self.state.unit_scale(),
        );
        let absolute_tool_length_mm = match self.state.distance_mode {
            DistanceMode::Absolute => self.active_tool_length_mm(),
            DistanceMode::Incremental => 0.0,
        };
        target.z_mm = target_axis(
            target.z_mm,
            word_value(words, 'Z'),
            offset.z_mm + absolute_tool_length_mm,
            self.state.distance_mode,
            self.state.unit_scale(),
        );
        target
    }

    fn active_tool_length_mm(&self) -> f64 {
        self.state
            .active_tool_length_offset
            .and_then(|number| self.options.tool_length_offsets_mm.get(&number))
            .copied()
            .map(canonical_zero)
            .unwrap_or(0.0)
    }

    fn work_offset(&self) -> Vec3Mm {
        self.options
            .work_offsets_mm
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(&self.state.work_coordinate))
            .map(|(_, value)| normalized_vec(value))
            .unwrap_or(Vec3Mm {
                x_mm: 0.0,
                y_mm: 0.0,
                z_mm: 0.0,
            })
    }

    fn finish(mut self, source: &str) -> ParseResult {
        sort_diagnostics(&mut self.diagnostics);
        let accepted = !self.diagnostics.iter().any(|diagnostic| {
            diagnostic.severity == DiagnosticSeverity::Error && !diagnostic.recoverable
        });
        if !accepted {
            return self.fail_closed();
        }

        let source_hash = Sha256::digest(source.as_bytes());
        let option_scope = match canonical_option_scope(self.options) {
            Ok(scope) => scope,
            Err(error) => {
                self.error(
                    1,
                    1,
                    "semantic.numeric.non_finite",
                    false,
                    format!("validated parse options could not be canonicalized: {error}"),
                );
                return self.fail_closed();
            }
        };
        let toolpath_id =
            self.options.toolpath_id.clone().unwrap_or_else(|| {
                deterministic_uuid(&source_hash, 0, 0, "toolpath", &option_scope)
            });
        let mut segment_scope = Vec::with_capacity(
            toolpath_id.len() + self.options.operation_id.len() + option_scope.len() + 2,
        );
        segment_scope.extend_from_slice(toolpath_id.as_bytes());
        segment_scope.push(0);
        segment_scope.extend_from_slice(self.options.operation_id.as_bytes());
        segment_scope.push(0);
        segment_scope.extend_from_slice(&option_scope);
        let mut segments = Vec::new();
        let mut source_line_map = Vec::new();
        let mut lengths = PathLengthMm {
            total: 0.0,
            rapid: 0.0,
            feed: 0.0,
        };
        let mut path_overflow_line = None;
        for (index, motion) in self.motions.iter().enumerate() {
            let sequence = index as u64;
            let line = motion_source_line(motion);
            let id = deterministic_uuid(
                &source_hash,
                sequence,
                line,
                motion_kind(motion),
                &segment_scope,
            );
            let (segment, length, rapid) = lower_motion(motion, id.clone(), sequence);
            if let Some(segment) = segment {
                let next_total = lengths.total + length;
                let next_rapid = if rapid {
                    lengths.rapid + length
                } else {
                    lengths.rapid
                };
                let next_feed = if rapid {
                    lengths.feed
                } else {
                    lengths.feed + length
                };
                if !next_total.is_finite() || !next_rapid.is_finite() || !next_feed.is_finite() {
                    path_overflow_line = Some(line);
                    break;
                }
                lengths.total = next_total;
                lengths.rapid = next_rapid;
                lengths.feed = next_feed;
                segments.push(segment);
                source_line_map.push(SourceLineMapEntry {
                    segment_id: id,
                    source_line: line,
                });
            }
        }
        if let Some(line) = path_overflow_line {
            self.error(
                line as usize,
                1,
                "semantic.numeric.non_finite",
                false,
                "aggregate path length overflowed the finite wire-number range",
            );
            return self.fail_closed();
        }
        let toolpath = ToolpathIr {
            schema_version: SCHEMA_VERSION,
            id: toolpath_id,
            operation_id: self.options.operation_id.clone(),
            coordinate_system: CoordinateSystem::Machine,
            feed_mode: match self.state.feed_mode {
                FeedMode::UnitsPerMinute => ToolpathFeedMode::UnitsPerMinute,
                FeedMode::UnitsPerRevolution => ToolpathFeedMode::UnitsPerRevolution,
            },
            spindle_mode: match self.state.spindle_mode {
                SpindleMode::Rpm => IrSpindleMode::Rpm,
                SpindleMode::SurfaceSpeed => IrSpindleMode::SurfaceSpeed,
            },
            segments,
            source_line_map,
        };

        let final_state = self.state.final_state();
        ParseResult {
            dialect: DIALECT.to_owned(),
            accepted: true,
            toolpath: Some(toolpath),
            canonical_motions: self.motions,
            program_control_events: self.control_events,
            diagnostics: self.diagnostics,
            endpoint_mm: final_state.position_mm.clone(),
            final_state,
            path_length_mm: lengths,
        }
    }

    fn fail_closed(mut self) -> ParseResult {
        sort_diagnostics(&mut self.diagnostics);
        let final_state = ModalState::safe_initial(self.options).final_state();
        ParseResult {
            dialect: DIALECT.to_owned(),
            accepted: false,
            toolpath: None,
            canonical_motions: Vec::new(),
            program_control_events: Vec::new(),
            diagnostics: self.diagnostics,
            endpoint_mm: final_state.position_mm.clone(),
            final_state,
            path_length_mm: PathLengthMm {
                total: 0.0,
                rapid: 0.0,
                feed: 0.0,
            },
        }
    }

    fn error(
        &mut self,
        line: usize,
        column: usize,
        code: &str,
        recoverable: bool,
        message: impl Into<String>,
    ) {
        if !push_diagnostic_with_limit(
            &mut self.diagnostics,
            Diagnostic::error(line, column, code, recoverable, message),
            self.limits.diagnostics,
        ) {
            self.diagnostic_limit_reached = true;
        }
    }
}

fn sort_diagnostics(diagnostics: &mut [Diagnostic]) {
    diagnostics.sort_by_key(|diagnostic| {
        (
            is_terminal_resource_diagnostic(diagnostic),
            diagnostic.line,
            diagnostic.column,
        )
    });
}

fn is_terminal_resource_diagnostic(diagnostic: &Diagnostic) -> bool {
    diagnostic.code == "request.resource_limit" && !diagnostic.recoverable
}
fn canonical_option_scope(options: &ParseOptions) -> Result<Vec<u8>, String> {
    let value =
        serde_json::to_value(options).map_err(|error| format!("options.serialize: {error}"))?;
    canonical_json(&value)
        .map(String::into_bytes)
        .map_err(|error| error.to_string())
}

fn input_number_is_wire_safe(value: f64) -> bool {
    value.is_finite() && !(value == 0.0 && value.is_sign_negative())
}

fn input_vec_is_wire_safe(value: &Vec3Mm) -> bool {
    input_number_is_wire_safe(value.x_mm)
        && input_number_is_wire_safe(value.y_mm)
        && input_number_is_wire_safe(value.z_mm)
}

fn input_rotary_is_wire_safe(value: &RotaryPositionRad) -> bool {
    input_number_is_wire_safe(value.a_rad)
        && input_number_is_wire_safe(value.b_rad)
        && input_number_is_wire_safe(value.c_rad)
}

fn canonical_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

fn normalized_vec(value: &Vec3Mm) -> Vec3Mm {
    Vec3Mm {
        x_mm: canonical_zero(value.x_mm),
        y_mm: canonical_zero(value.y_mm),
        z_mm: canonical_zero(value.z_mm),
    }
}

fn normalized_rotary(value: RotaryPositionRad) -> RotaryPositionRad {
    RotaryPositionRad {
        a_rad: canonical_zero(value.a_rad),
        b_rad: canonical_zero(value.b_rad),
        c_rad: canonical_zero(value.c_rad),
    }
}

fn number_is_wire_safe(value: f64) -> bool {
    value.is_finite()
}

fn vec_is_wire_safe(value: &Vec3Mm) -> bool {
    number_is_wire_safe(value.x_mm)
        && number_is_wire_safe(value.y_mm)
        && number_is_wire_safe(value.z_mm)
}

fn rotary_is_wire_safe(value: &RotaryPositionRad) -> bool {
    number_is_wire_safe(value.a_rad)
        && number_is_wire_safe(value.b_rad)
        && number_is_wire_safe(value.c_rad)
}

fn motion_numbers_are_finite(motion: &CanonicalMotion) -> bool {
    match motion {
        CanonicalMotion::Rapid {
            start_mm,
            end_mm,
            start_rotary_rad,
            end_rotary_rad,
            ..
        } => {
            vec_is_wire_safe(start_mm)
                && vec_is_wire_safe(end_mm)
                && rotary_is_wire_safe(start_rotary_rad)
                && rotary_is_wire_safe(end_rotary_rad)
                && distance(start_mm, end_mm).is_finite()
        }
        CanonicalMotion::Linear {
            start_mm,
            end_mm,
            start_rotary_rad,
            end_rotary_rad,
            feed_mm_per_min,
            ..
        } => {
            vec_is_wire_safe(start_mm)
                && vec_is_wire_safe(end_mm)
                && rotary_is_wire_safe(start_rotary_rad)
                && rotary_is_wire_safe(end_rotary_rad)
                && number_is_wire_safe(*feed_mm_per_min)
                && *feed_mm_per_min > 0.0
                && distance(start_mm, end_mm).is_finite()
        }
        CanonicalMotion::Arc {
            start_mm,
            end_mm,
            center_offset_mm,
            plane,
            clockwise,
            feed_mm_per_min,
            ..
        } => {
            vec_is_wire_safe(start_mm)
                && vec_is_wire_safe(end_mm)
                && vec_is_wire_safe(center_offset_mm)
                && number_is_wire_safe(*feed_mm_per_min)
                && *feed_mm_per_min > 0.0
                && arc_length(start_mm, end_mm, center_offset_mm, *plane, *clockwise).is_finite()
        }
        CanonicalMotion::Dwell {
            position_mm,
            duration_s,
            ..
        } => vec_is_wire_safe(position_mm) && number_is_wire_safe(*duration_s),
        CanonicalMotion::ToolChange { position_mm, .. } => vec_is_wire_safe(position_mm),
    }
}

fn raw_number_is_integral(word: &Word) -> bool {
    let Some(raw_number) = word.raw.get(1..) else {
        return false;
    };
    let unsigned = raw_number
        .strip_prefix('+')
        .or_else(|| raw_number.strip_prefix('-'))
        .unwrap_or(raw_number);
    let (integer, fraction) = unsigned
        .split_once('.')
        .map_or((unsigned, None), |(integer, fraction)| {
            (integer, Some(fraction))
        });
    !integer.is_empty()
        && integer.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.is_none_or(|digits| digits.bytes().all(|byte| byte == b'0'))
}

fn integer_code(word: &Word) -> Option<i32> {
    if raw_number_is_integral(word)
        && word.value >= 0.0
        && word.value <= i32::MAX as f64
        && word.value.fract() == 0.0
    {
        Some(word.value as i32)
    } else {
        None
    }
}

fn positive_u32_word(word: &Word) -> Option<u32> {
    if raw_number_is_integral(word)
        && word.value > 0.0
        && word.value <= u32::MAX as f64
        && word.value.fract() == 0.0
    {
        Some(word.value as u32)
    } else {
        None
    }
}

fn g_modal_group(code: i32) -> Option<&'static str> {
    match code {
        0..=3 | 80..=89 => Some("motion"),
        17..=19 => Some("plane"),
        20 | 21 => Some("units"),
        40..=42 => Some("cutter"),
        43 | 49 => Some("tool-length"),
        54..=59 => Some("work-coordinate"),
        90 | 91 => Some("distance"),
        94 | 95 => Some("feed"),
        96 | 97 => Some("spindle"),
        98 | 99 => Some("return"),
        _ => None,
    }
}

fn word_value(words: &[Word], letter: char) -> Option<f64> {
    words
        .iter()
        .find(|word| word.letter == letter)
        .map(|word| word.value)
}

fn column_of(words: &[Word], letter: char) -> usize {
    words
        .iter()
        .find(|word| word.letter == letter)
        .map_or(1, |word| word.column as usize)
}

fn code_column(words: &[Word], letter: char, code: i32) -> usize {
    words
        .iter()
        .find(|word| word.letter == letter && integer_code(word) == Some(code))
        .map_or(1, |word| word.column as usize)
}

fn first_axis_column(words: &[Word]) -> usize {
    words
        .iter()
        .find(|word| matches!(word.letter, 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'))
        .map_or(1, |word| word.column as usize)
}

fn first_rotary_column(words: &[Word]) -> usize {
    words
        .iter()
        .find(|word| matches!(word.letter, 'A' | 'B' | 'C'))
        .map_or(1, |word| word.column as usize)
}

fn target_axis(
    current: f64,
    word: Option<f64>,
    offset: f64,
    mode: DistanceMode,
    scale: f64,
) -> f64 {
    match (word, mode) {
        (None, _) => current,
        (Some(value), DistanceMode::Absolute) => canonical_zero(value * scale + offset),
        (Some(value), DistanceMode::Incremental) => canonical_zero(current + value * scale),
    }
}

fn drill_value(point: &Vec3Mm, plane: Plane) -> f64 {
    match plane {
        Plane::Xy => point.z_mm,
        Plane::Xz => point.y_mm,
        Plane::Yz => point.x_mm,
    }
}

fn set_drill_value(point: &mut Vec3Mm, plane: Plane, value: f64) {
    let value = canonical_zero(value);
    match plane {
        Plane::Xy => point.z_mm = value,
        Plane::Xz => point.y_mm = value,
        Plane::Yz => point.x_mm = value,
    }
}

fn drill_word(words: &[Word], plane: Plane) -> Option<f64> {
    word_value(
        words,
        match plane {
            Plane::Xy => 'Z',
            Plane::Xz => 'Y',
            Plane::Yz => 'X',
        },
    )
}

fn motion_source_line(motion: &CanonicalMotion) -> u64 {
    match motion {
        CanonicalMotion::Rapid { source_line, .. }
        | CanonicalMotion::Linear { source_line, .. }
        | CanonicalMotion::Arc { source_line, .. }
        | CanonicalMotion::Dwell { source_line, .. }
        | CanonicalMotion::ToolChange { source_line, .. } => *source_line,
    }
}

fn motion_kind(motion: &CanonicalMotion) -> &'static str {
    match motion {
        CanonicalMotion::Rapid { .. } => "rapid",
        CanonicalMotion::Linear { .. } => "linear",
        CanonicalMotion::Arc { .. } => "arc",
        CanonicalMotion::Dwell { .. } => "dwell",
        CanonicalMotion::ToolChange { .. } => "tool-change",
    }
}

fn lower_motion(
    motion: &CanonicalMotion,
    id: String,
    sequence: u64,
) -> (Option<ToolpathSegment>, f64, bool) {
    let base = |schema_version, id, sequence| (schema_version, id, sequence);
    match motion {
        CanonicalMotion::Rapid {
            start_mm, end_mm, ..
        } => {
            let (schema_version, id, sequence) = base(SCHEMA_VERSION, id, sequence);
            (
                Some(ToolpathSegment::Rapid {
                    schema_version,
                    id,
                    sequence,
                    start_mm: start_mm.clone(),
                    end_mm: end_mm.clone(),
                }),
                distance(start_mm, end_mm),
                true,
            )
        }
        CanonicalMotion::Linear {
            start_mm,
            end_mm,
            feed_mm_per_min,
            ..
        } => {
            let (schema_version, id, sequence) = base(SCHEMA_VERSION, id, sequence);
            (
                Some(ToolpathSegment::Linear {
                    schema_version,
                    id,
                    sequence,
                    start_mm: start_mm.clone(),
                    end_mm: end_mm.clone(),
                    feed_mm_per_min: *feed_mm_per_min,
                }),
                distance(start_mm, end_mm),
                false,
            )
        }
        CanonicalMotion::Arc {
            start_mm,
            end_mm,
            center_offset_mm,
            plane,
            clockwise,
            feed_mm_per_min,
            ..
        } => {
            let length = arc_length(start_mm, end_mm, center_offset_mm, *plane, *clockwise);
            let (schema_version, id, sequence) = base(SCHEMA_VERSION, id, sequence);
            (
                Some(ToolpathSegment::Arc {
                    schema_version,
                    id,
                    sequence,
                    start_mm: start_mm.clone(),
                    end_mm: end_mm.clone(),
                    center_offset_mm: center_offset_mm.clone(),
                    plane: match plane {
                        Plane::Xy => ArcPlane::Xy,
                        Plane::Xz => ArcPlane::Xz,
                        Plane::Yz => ArcPlane::Yz,
                    },
                    clockwise: *clockwise,
                    feed_mm_per_min: *feed_mm_per_min,
                }),
                length,
                false,
            )
        }
        CanonicalMotion::Dwell {
            position_mm,
            duration_s,
            ..
        } => {
            let (schema_version, id, sequence) = base(SCHEMA_VERSION, id, sequence);
            (
                Some(ToolpathSegment::Dwell {
                    schema_version,
                    id,
                    sequence,
                    position_mm: position_mm.clone(),
                    duration_s: *duration_s,
                }),
                0.0,
                false,
            )
        }
        CanonicalMotion::ToolChange {
            position_mm,
            tool_assembly_id,
            ..
        } => {
            let (schema_version, id, sequence) = base(SCHEMA_VERSION, id, sequence);
            (
                Some(ToolpathSegment::ToolChange {
                    schema_version,
                    id,
                    sequence,
                    position_mm: position_mm.clone(),
                    tool_assembly_id: tool_assembly_id.clone(),
                }),
                0.0,
                false,
            )
        }
    }
}

fn deterministic_uuid(
    source_hash: &[u8],
    sequence: u64,
    source_line: u64,
    kind: &str,
    scope: &[u8],
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"cnc-render:gcode-core:v1\0");
    digest.update(source_hash);
    digest.update(scope);
    digest.update(sequence.to_be_bytes());
    digest.update(source_line.to_be_bytes());
    digest.update(kind.as_bytes());
    let hash = digest.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes[index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'A' | b'b' | b'B')
}

#[cfg(test)]
mod tests {
    use super::{canonical_option_scope, compile, compile_with_limits};
    use crate::limits::GcodeResourceLimits;
    use crate::model::ParseOptions;

    #[test]
    fn straight_motion_is_lowered_in_mm() {
        let result = compile("G21 G90\nG0 X1 Y2\nG1 X4 F60\n", &ParseOptions::default());
        assert!(result.accepted, "{:?}", result.diagnostics);
        assert_eq!(result.endpoint_mm.x_mm, 4.0);
        assert_eq!(result.path_length_mm.feed, 3.0);
        assert_eq!(
            result
                .toolpath
                .as_ref()
                .expect("toolpath")
                .source_line_map
                .len(),
            2
        );
    }

    #[test]
    fn parses_are_deterministic() {
        let options = ParseOptions::default();
        let first = serde_json::to_vec(&compile("G1 X1 F10", &options)).expect("serialize");
        for _ in 0..100 {
            let next = serde_json::to_vec(&compile("G1 X1 F10", &options)).expect("serialize");
            assert_eq!(first, next);
        }
    }

    #[test]
    fn option_scope_uses_m1_rfc8785_canonical_json() {
        let scope = canonical_option_scope(&ParseOptions::default()).expect("canonical options");
        assert_eq!(
            String::from_utf8(scope).expect("UTF-8 canonical JSON"),
            r#"{"dialect":"common-v1","initialState":{"positionMm":{"xMm":0,"yMm":0,"zMm":0},"rotaryRad":{"aRad":0,"bRad":0,"cRad":0}},"operationId":"1c5cbff7-5118-5ea4-8d41-f024790fa322","toolLengthOffsetsMm":{},"toolNumbers":{},"toolpathId":null,"workOffsetsMm":{}}"#,
        );
    }

    #[test]
    fn canonical_option_map_order_produces_stable_default_id() {
        let first_id = "20000000-0000-4000-8000-000000000001".to_owned();
        let second_id = "20000000-0000-4000-8000-000000000002".to_owned();
        let mut first = ParseOptions::default();
        first.tool_numbers.insert(2, second_id.clone());
        first.tool_numbers.insert(1, first_id.clone());
        let mut second = ParseOptions::default();
        second.tool_numbers.insert(1, first_id);
        second.tool_numbers.insert(2, second_id);

        assert_eq!(
            canonical_option_scope(&first).expect("first canonical options"),
            canonical_option_scope(&second).expect("second canonical options"),
        );
        let first_toolpath_id = compile("G0 X1", &first)
            .toolpath
            .expect("first toolpath")
            .id;
        let second_toolpath_id = compile("G0 X1", &second)
            .toolpath
            .expect("second toolpath")
            .id;
        assert_eq!(first_toolpath_id, second_toolpath_id);
    }
    #[test]
    fn canonical_motion_limit_is_inclusive_and_fail_closed() {
        let limits = GcodeResourceLimits {
            canonical_motions: 2,
            ..GcodeResourceLimits::default()
        };
        let below = compile_with_limits("G0 X1", &ParseOptions::default(), limits);
        assert!(below.accepted, "{:?}", below.diagnostics);
        assert_eq!(below.canonical_motions.len(), 1);

        let exact = compile_with_limits("G0 X1\nX2", &ParseOptions::default(), limits);
        assert!(exact.accepted, "{:?}", exact.diagnostics);
        assert_eq!(exact.canonical_motions.len(), 2);

        let exceeded = compile_with_limits("G0 X1\nX2\nX3", &ParseOptions::default(), limits);
        assert!(!exceeded.accepted);
        assert!(exceeded.toolpath.is_none());
        assert!(exceeded.canonical_motions.is_empty());
        let motion_limits: Vec<_> = exceeded
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "semantic.motion.limit")
            .collect();
        assert_eq!(motion_limits.len(), 1);
        assert_eq!((motion_limits[0].line, motion_limits[0].column), (3, 1));
    }

    #[test]
    fn canned_cycles_stop_on_first_motion_over_limit_and_roll_back() {
        for (source, limit) in [
            ("G21 G90 G99 G82 Z-1 R0 P1 F100", 1),
            ("G21 G90 G99 G83 Z-2 R0 Q1 F100", 3),
        ] {
            let result = compile_with_limits(
                source,
                &ParseOptions::default(),
                GcodeResourceLimits {
                    canonical_motions: limit,
                    ..GcodeResourceLimits::default()
                },
            );
            assert!(!result.accepted, "{source}");
            assert!(result.toolpath.is_none(), "{source}");
            assert!(result.canonical_motions.is_empty(), "{source}");
            assert_eq!(
                result
                    .diagnostics
                    .iter()
                    .filter(|diagnostic| diagnostic.code == "semantic.motion.limit")
                    .count(),
                1,
                "{source}: {:?}",
                result.diagnostics
            );
        }
    }

    #[test]
    fn compiler_diagnostic_flood_stops_at_terminal_resource_error() {
        let result = compile_with_limits(
            "D1 E1 L1",
            &ParseOptions::default(),
            GcodeResourceLimits {
                diagnostics: 3,
                ..GcodeResourceLimits::default()
            },
        );

        assert!(!result.accepted);
        assert_eq!(result.diagnostics.len(), 3);
        assert_eq!(result.diagnostics[0].code, "parser.word.unsupported");
        assert_eq!(result.diagnostics[1].code, "parser.word.unsupported");
        assert_eq!(result.diagnostics[2].code, "request.resource_limit");
        assert_eq!(
            (result.diagnostics[2].line, result.diagnostics[2].column),
            (1, 7)
        );
        assert!(!result.diagnostics[2].recoverable);
    }

    #[test]
    fn g83_integer_index_honors_exact_parse_wide_peck_boundary() {
        let exact = compile(
            "G21 G90 G99 G83 Z0.1295236924863196 R0.12954069248631958 Q0.00000000017 F100",
            &ParseOptions::default(),
        );
        assert!(exact.accepted, "{:?}", exact.diagnostics);
        assert_eq!(exact.canonical_motions.len(), 200_001);

        let exceeded = compile(
            "G21 G90 G99 G83 Z0 R1 Q0.0000099999 F100",
            &ParseOptions::default(),
        );
        assert!(!exceeded.accepted);
        assert!(exceeded.toolpath.is_none());
        assert!(exceeded.canonical_motions.is_empty());
        assert_eq!(
            exceeded
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.code == "semantic.cycle.expansion_limit")
                .count(),
            1
        );
    }
    #[test]
    fn parsed_fatal_short_circuits_all_later_lowering() {
        let mut source = String::from("@\n");
        for _ in 0..20_000 {
            source.push_str("G0 X1\n");
        }
        let result = compile_with_limits(
            &source,
            &ParseOptions::default(),
            GcodeResourceLimits {
                canonical_motions: 0,
                ..GcodeResourceLimits::default()
            },
        );

        assert!(!result.accepted);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "lexer.symbol.unsupported")
        );
        assert!(
            !result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "semantic.motion.limit")
        );
    }
}
