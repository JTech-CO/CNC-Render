use std::f64::consts::{PI, TAU};

use cnc_render_contracts::domain::Vec3Mm;

use crate::model::{Plane, UnitMode};

pub(crate) fn distance(a: &Vec3Mm, b: &Vec3Mm) -> f64 {
    (b.x_mm - a.x_mm)
        .hypot(b.y_mm - a.y_mm)
        .hypot(b.z_mm - a.z_mm)
}

pub(crate) fn plane_coordinates(point: &Vec3Mm, plane: Plane) -> (f64, f64, f64) {
    match plane {
        Plane::Xy => (point.x_mm, point.y_mm, point.z_mm),
        Plane::Xz => (point.z_mm, point.x_mm, point.y_mm),
        Plane::Yz => (point.y_mm, point.z_mm, point.x_mm),
    }
}

pub(crate) fn offset_from_plane(u: f64, v: f64, plane: Plane) -> Vec3Mm {
    match plane {
        Plane::Xy => Vec3Mm {
            x_mm: u,
            y_mm: v,
            z_mm: 0.0,
        },
        Plane::Xz => Vec3Mm {
            x_mm: v,
            y_mm: 0.0,
            z_mm: u,
        },
        Plane::Yz => Vec3Mm {
            x_mm: 0.0,
            y_mm: u,
            z_mm: v,
        },
    }
}

pub(crate) fn sweep_radians(
    start: &Vec3Mm,
    end: &Vec3Mm,
    center_offset: &Vec3Mm,
    plane: Plane,
    clockwise: bool,
) -> f64 {
    let (su, sv, _) = plane_coordinates(start, plane);
    let (eu, ev, _) = plane_coordinates(end, plane);
    let (ou, ov, _) = plane_coordinates(center_offset, plane);
    let center_u = su + ou;
    let center_v = sv + ov;
    let start_angle = (sv - center_v).atan2(su - center_u);
    let end_angle = (ev - center_v).atan2(eu - center_u);
    if (su - eu).abs() <= 1.0e-12 && (sv - ev).abs() <= 1.0e-12 {
        return TAU;
    }
    if clockwise {
        (start_angle - end_angle).rem_euclid(TAU)
    } else {
        (end_angle - start_angle).rem_euclid(TAU)
    }
}

pub(crate) fn arc_length(
    start: &Vec3Mm,
    end: &Vec3Mm,
    center_offset: &Vec3Mm,
    plane: Plane,
    clockwise: bool,
) -> f64 {
    let (ou, ov, _) = plane_coordinates(center_offset, plane);
    let (_, _, sw) = plane_coordinates(start, plane);
    let (_, _, ew) = plane_coordinates(end, plane);
    let planar = ou.hypot(ov) * sweep_radians(start, end, center_offset, plane, clockwise);
    planar.hypot(ew - sw)
}

pub(crate) fn center_from_radius(
    start: &Vec3Mm,
    end: &Vec3Mm,
    plane: Plane,
    radius: f64,
    clockwise: bool,
) -> Result<Vec3Mm, &'static str> {
    let (su, sv, _) = plane_coordinates(start, plane);
    let (eu, ev, _) = plane_coordinates(end, plane);
    let du = eu - su;
    let dv = ev - sv;
    let chord = du.hypot(dv);
    if chord <= 1.0e-12 {
        return Err("full-circle radius arcs are ambiguous");
    }
    let magnitude = radius.abs();
    if magnitude + 1.0e-10 < chord / 2.0 {
        return Err("arc radius is smaller than half the chord");
    }
    let midpoint_u = (su + eu) / 2.0;
    let midpoint_v = (sv + ev) / 2.0;
    let height = (magnitude.mul_add(magnitude, -(chord * chord / 4.0)))
        .max(0.0)
        .sqrt();
    let normal_u = -dv / chord;
    let normal_v = du / chord;
    let candidates = [
        (
            midpoint_u + normal_u * height,
            midpoint_v + normal_v * height,
        ),
        (
            midpoint_u - normal_u * height,
            midpoint_v - normal_v * height,
        ),
    ];
    let want_major = radius.is_sign_negative();
    let mut selected = candidates[0];
    for candidate in candidates {
        let offset = offset_from_plane(candidate.0 - su, candidate.1 - sv, plane);
        let sweep = sweep_radians(start, end, &offset, plane, clockwise);
        let is_major = sweep > PI + 1.0e-10;
        if is_major == want_major || (sweep - PI).abs() <= 1.0e-10 {
            selected = candidate;
            break;
        }
    }
    Ok(offset_from_plane(selected.0 - su, selected.1 - sv, plane))
}

pub(crate) fn radius_matches(
    start: &Vec3Mm,
    end: &Vec3Mm,
    center_offset: &Vec3Mm,
    plane: Plane,
    unit_mode: UnitMode,
) -> bool {
    let (su, sv, _) = plane_coordinates(start, plane);
    let (eu, ev, _) = plane_coordinates(end, plane);
    let (ou, ov, _) = plane_coordinates(center_offset, plane);
    let center_u = su + ou;
    let center_v = sv + ov;
    let start_radius = ou.hypot(ov);
    let end_radius = (eu - center_u).hypot(ev - center_v);
    let (small_tolerance_mm, big_tolerance_mm) = match unit_mode {
        UnitMode::Millimeter => (0.005, 0.5),
        UnitMode::Inch => (0.0127, 1.27),
    };
    let tolerance_mm = (start_radius * 0.001)
        .max(small_tolerance_mm)
        .min(big_tolerance_mm);
    start_radius > 1.0e-12 && (start_radius - end_radius).abs() <= tolerance_mm
}

#[cfg(test)]
mod tests {
    use cnc_render_contracts::domain::Vec3Mm;

    use super::{arc_length, center_from_radius};
    use crate::model::Plane;

    #[test]
    fn positive_and_negative_radius_choose_minor_and_major() {
        let start = Vec3Mm {
            x_mm: 0.0,
            y_mm: 0.0,
            z_mm: 0.0,
        };
        let end = Vec3Mm {
            x_mm: 10.0,
            y_mm: 0.0,
            z_mm: 0.0,
        };
        let minor = center_from_radius(&start, &end, Plane::Xy, 10.0, false).expect("minor center");
        let major =
            center_from_radius(&start, &end, Plane::Xy, -10.0, false).expect("major center");
        assert!(arc_length(&start, &end, &minor, Plane::Xy, false) < 20.0);
        assert!(arc_length(&start, &end, &major, Plane::Xy, false) > 40.0);
    }
}
