use std::collections::{HashMap, HashSet};

use crate::{
    domain::{Project, ToolpathSegment},
    validation::{ContractError, ContractResult},
};

pub(crate) fn validate_project_semantics(project: &Project) -> ContractResult<()> {
    validate_timestamp_order(project)?;
    validate_global_ids(project)?;
    validate_axis_roots(project)?;
    validate_collision_group_references(project)?;
    validate_toolpath_semantics(project)
}

fn validate_timestamp_order(project: &Project) -> ContractResult<()> {
    if timestamp_key(&project.created_at) <= timestamp_key(&project.updated_at) {
        Ok(())
    } else {
        contract_error(
            "project.timestamp_order",
            "$.updatedAt",
            "updatedAt must be greater than or equal to createdAt",
        )
    }
}

fn timestamp_key(value: &str) -> (u32, u32, u32, u32, u32, u32, u32) {
    let bytes = value.as_bytes();
    let number = |start: usize, end: usize| {
        bytes[start..end]
            .iter()
            .fold(0_u32, |value, digit| value * 10 + u32::from(*digit - b'0'))
    };
    let fractional_digits = if bytes.len() == 20 {
        &bytes[0..0]
    } else {
        &bytes[20..bytes.len() - 1]
    };
    let fraction = fractional_digits
        .iter()
        .fold(0_u32, |value, digit| value * 10 + u32::from(*digit - b'0'));
    let nanoseconds = fraction * 10_u32.pow(9 - fractional_digits.len() as u32);

    (
        number(0, 4),
        number(5, 7),
        number(8, 10),
        number(11, 13),
        number(14, 16),
        number(17, 19),
        nanoseconds,
    )
}

fn validate_global_ids(project: &Project) -> ContractResult<()> {
    let mut ids = HashMap::<String, String>::new();
    register_id(&mut ids, &project.id, "$.id")?;

    for (machine_index, machine) in project.machines.iter().enumerate() {
        let machine_path = format!("$.machines[{machine_index}]");
        register_id(&mut ids, &machine.id, &format!("{machine_path}.id"))?;
        for (axis_index, axis) in machine.axes.iter().enumerate() {
            register_id(
                &mut ids,
                axis.id(),
                &format!("{machine_path}.axes[{axis_index}].id"),
            )?;
        }
        for (spindle_index, spindle) in machine.spindles.iter().enumerate() {
            register_id(
                &mut ids,
                &spindle.id,
                &format!("{machine_path}.spindles[{spindle_index}].id"),
            )?;
        }
        for (group_index, group) in machine.collision_groups.iter().enumerate() {
            register_id(
                &mut ids,
                &group.id,
                &format!("{machine_path}.collisionGroups[{group_index}].id"),
            )?;
        }
    }

    for (index, material) in project.materials.iter().enumerate() {
        register_id(&mut ids, &material.id, &format!("$.materials[{index}].id"))?;
    }
    for (index, setup) in project.setups.iter().enumerate() {
        register_id(&mut ids, &setup.id, &format!("$.setups[{index}].id"))?;
    }
    for (index, tool) in project.tool_assemblies.iter().enumerate() {
        register_id(&mut ids, &tool.id, &format!("$.toolAssemblies[{index}].id"))?;
    }
    for (index, stock) in project.stocks.iter().enumerate() {
        register_id(&mut ids, &stock.id, &format!("$.stocks[{index}].id"))?;
    }
    for (index, operation) in project.operations.iter().enumerate() {
        register_id(
            &mut ids,
            &operation.id,
            &format!("$.operations[{index}].id"),
        )?;
    }
    for (toolpath_index, toolpath) in project.toolpaths.iter().enumerate() {
        let toolpath_path = format!("$.toolpaths[{toolpath_index}]");
        register_id(&mut ids, &toolpath.id, &format!("{toolpath_path}.id"))?;
        for (segment_index, segment) in toolpath.segments.iter().enumerate() {
            register_id(
                &mut ids,
                segment.id(),
                &format!("{toolpath_path}.segments[{segment_index}].id"),
            )?;
        }
    }
    for (index, resource) in project.resources.iter().enumerate() {
        register_id(&mut ids, &resource.id, &format!("$.resources[{index}].id"))?;
    }
    Ok(())
}

fn register_id(ids: &mut HashMap<String, String>, id: &str, path: &str) -> ContractResult<()> {
    if let Some(first_path) = ids.insert(id.to_owned(), path.to_owned()) {
        contract_error(
            "id.duplicate_global",
            path,
            format!("ID is already used at {first_path}"),
        )
    } else {
        Ok(())
    }
}

fn validate_axis_roots(project: &Project) -> ContractResult<()> {
    for (machine_index, machine) in project.machines.iter().enumerate() {
        let machine_path = format!("$.machines[{machine_index}]");
        let mut roots = HashSet::new();
        for (root_index, root_id) in machine.kinematic_root_axis_ids.iter().enumerate() {
            if !roots.insert(root_id.as_str()) {
                return contract_error(
                    "axis.root_duplicate",
                    format!("{machine_path}.kinematicRootAxisIds[{root_index}]"),
                    "kinematic root axis IDs must be unique",
                );
            }
        }

        for (axis_index, axis) in machine.axes.iter().enumerate() {
            let listed_as_root = roots.contains(axis.id());
            if axis.parent_id().is_none() != listed_as_root {
                return contract_error(
                    "axis.root_incomplete",
                    format!("{machine_path}.axes[{axis_index}].parentId"),
                    "every parentless axis must appear exactly once in kinematicRootAxisIds",
                );
            }
        }
    }
    Ok(())
}

fn validate_collision_group_references(project: &Project) -> ContractResult<()> {
    let resources: HashSet<&str> = project
        .resources
        .iter()
        .map(|resource| resource.id.as_str())
        .collect();
    for (machine_index, machine) in project.machines.iter().enumerate() {
        for (group_index, group) in machine.collision_groups.iter().enumerate() {
            for (member_index, member_id) in group.member_resource_ids.iter().enumerate() {
                if !resources.contains(member_id.as_str()) {
                    return contract_error(
                        "reference.missing",
                        format!(
                            "$.machines[{machine_index}].collisionGroups[{group_index}].memberResourceIds[{member_index}]"
                        ),
                        "collision group member must reference resources",
                    );
                }
            }
        }
    }
    Ok(())
}

fn validate_toolpath_semantics(project: &Project) -> ContractResult<()> {
    let tools: HashSet<&str> = project
        .tool_assemblies
        .iter()
        .map(|tool| tool.id.as_str())
        .collect();

    for (toolpath_index, toolpath) in project.toolpaths.iter().enumerate() {
        let toolpath_path = format!("$.toolpaths[{toolpath_index}]");
        let mut segment_ids = HashSet::new();
        let mut previous_sequence = None;

        for (segment_index, segment) in toolpath.segments.iter().enumerate() {
            segment_ids.insert(segment.id());
            let sequence = segment_sequence(segment);
            if previous_sequence.is_some_and(|previous| sequence <= previous) {
                return contract_error(
                    "toolpath.sequence_not_increasing",
                    format!("{toolpath_path}.segments[{segment_index}].sequence"),
                    "toolpath segment sequence must be unique and strictly increasing",
                );
            }
            previous_sequence = Some(sequence);

            if let ToolpathSegment::ToolChange {
                tool_assembly_id, ..
            } = segment
                && !tools.contains(tool_assembly_id.as_str())
            {
                return contract_error(
                    "reference.missing",
                    format!("{toolpath_path}.segments[{segment_index}].toolAssemblyId"),
                    "tool-change segment must reference toolAssemblies",
                );
            }
        }

        let mut mapped_segments = HashSet::new();
        for (mapping_index, mapping) in toolpath.source_line_map.iter().enumerate() {
            if !segment_ids.contains(mapping.segment_id.as_str()) {
                return contract_error(
                    "reference.missing",
                    format!("{toolpath_path}.sourceLineMap[{mapping_index}].segmentId"),
                    "sourceLineMap must reference a segment in the same toolpath",
                );
            }
            if !mapped_segments.insert(mapping.segment_id.as_str()) {
                return contract_error(
                    "toolpath.source_line_duplicate",
                    format!("{toolpath_path}.sourceLineMap[{mapping_index}].segmentId"),
                    "each segment may appear at most once in sourceLineMap",
                );
            }
        }
    }
    Ok(())
}

fn segment_sequence(segment: &ToolpathSegment) -> u64 {
    match segment {
        ToolpathSegment::Rapid { sequence, .. }
        | ToolpathSegment::Linear { sequence, .. }
        | ToolpathSegment::Arc { sequence, .. }
        | ToolpathSegment::Dwell { sequence, .. }
        | ToolpathSegment::ToolChange { sequence, .. } => *sequence,
    }
}

fn contract_error<T>(
    code: &'static str,
    path: impl Into<String>,
    message: impl Into<String>,
) -> ContractResult<T> {
    Err(ContractError::new(code, path, message))
}
