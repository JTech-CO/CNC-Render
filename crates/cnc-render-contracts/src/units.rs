use serde::{Deserialize, Serialize};

use crate::validation::{ContractResult, require_finite, require_positive};

pub const MILLIMETERS_PER_INCH: f64 = 25.4;
pub const SECONDS_PER_MINUTE: f64 = 60.0;
pub const RADIANS_PER_DEGREE: f64 = std::f64::consts::PI / 180.0;

macro_rules! finite_quantity {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(f64);

        impl $name {
            pub fn try_new(value: f64) -> ContractResult<Self> {
                require_finite(value, stringify!($name)).map(Self)
            }

            pub const fn get(self) -> f64 {
                self.0
            }
        }
    };
}

macro_rules! positive_quantity {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(f64);

        impl $name {
            pub fn try_new(value: f64) -> ContractResult<Self> {
                require_positive(value, stringify!($name)).map(Self)
            }

            pub const fn get(self) -> f64 {
                self.0
            }
        }
    };
}

finite_quantity!(CoordinateMm);
finite_quantity!(AngleRad);
finite_quantity!(TimeS);
positive_quantity!(LengthMm);
positive_quantity!(SpindleSpeedRpm);
positive_quantity!(FeedMmPerMin);
positive_quantity!(FeedMmPerRev);
positive_quantity!(FeedMmPerTooth);

pub fn millimeters_to_inches(millimeters: f64) -> ContractResult<f64> {
    Ok(require_finite(millimeters, "millimeters")? / MILLIMETERS_PER_INCH)
}

pub fn inches_to_millimeters(inches: f64) -> ContractResult<f64> {
    Ok(require_finite(inches, "inches")? * MILLIMETERS_PER_INCH)
}

pub fn millimeters_per_minute_to_inches_per_minute(
    millimeters_per_minute: f64,
) -> ContractResult<f64> {
    Ok(require_finite(millimeters_per_minute, "millimetersPerMinute")? / MILLIMETERS_PER_INCH)
}

pub fn inches_per_minute_to_millimeters_per_minute(inches_per_minute: f64) -> ContractResult<f64> {
    Ok(require_finite(inches_per_minute, "inchesPerMinute")? * MILLIMETERS_PER_INCH)
}

pub fn millimeters_per_revolution_to_inches_per_revolution(
    millimeters_per_revolution: f64,
) -> ContractResult<f64> {
    Ok(
        require_finite(millimeters_per_revolution, "millimetersPerRevolution")?
            / MILLIMETERS_PER_INCH,
    )
}

pub fn inches_per_revolution_to_millimeters_per_revolution(
    inches_per_revolution: f64,
) -> ContractResult<f64> {
    Ok(require_finite(inches_per_revolution, "inchesPerRevolution")? * MILLIMETERS_PER_INCH)
}

pub fn millimeters_per_tooth_to_inches_per_tooth(
    millimeters_per_tooth: f64,
) -> ContractResult<f64> {
    Ok(require_finite(millimeters_per_tooth, "millimetersPerTooth")? / MILLIMETERS_PER_INCH)
}

pub fn inches_per_tooth_to_millimeters_per_tooth(inches_per_tooth: f64) -> ContractResult<f64> {
    Ok(require_finite(inches_per_tooth, "inchesPerTooth")? * MILLIMETERS_PER_INCH)
}

pub fn revolutions_per_minute_to_revolutions_per_second(
    revolutions_per_minute: f64,
) -> ContractResult<f64> {
    Ok(require_finite(revolutions_per_minute, "revolutionsPerMinute")? / SECONDS_PER_MINUTE)
}

pub fn revolutions_per_second_to_revolutions_per_minute(
    revolutions_per_second: f64,
) -> ContractResult<f64> {
    Ok(require_finite(revolutions_per_second, "revolutionsPerSecond")? * SECONDS_PER_MINUTE)
}

pub fn degrees_to_radians(degrees: f64) -> ContractResult<f64> {
    Ok(require_finite(degrees, "degrees")? * RADIANS_PER_DEGREE)
}

pub fn radians_to_degrees(radians: f64) -> ContractResult<f64> {
    Ok(require_finite(radians, "radians")? / RADIANS_PER_DEGREE)
}

pub fn round_for_display(value: f64, decimal_places: u32) -> ContractResult<f64> {
    let value = require_finite(value, "displayValue")?;
    let exponent = i32::try_from(decimal_places).unwrap_or(i32::MAX);
    let factor = 10_f64.powi(exponent);

    if !factor.is_finite() {
        return Ok(value);
    }

    Ok((value * factor).round() / factor)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::{
        CoordinateMm, FeedMmPerMin, LengthMm, SpindleSpeedRpm, degrees_to_radians,
        inches_per_minute_to_millimeters_per_minute,
        inches_per_revolution_to_millimeters_per_revolution,
        inches_per_tooth_to_millimeters_per_tooth, inches_to_millimeters,
        millimeters_per_minute_to_inches_per_minute,
        millimeters_per_revolution_to_inches_per_revolution,
        millimeters_per_tooth_to_inches_per_tooth, millimeters_to_inches, radians_to_degrees,
        revolutions_per_minute_to_revolutions_per_second,
        revolutions_per_second_to_revolutions_per_minute, round_for_display,
    };

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenUnits {
        feeds: GoldenFeeds,
        absolute_tolerance: f64,
        relative_tolerance: f64,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenFeeds {
        rpm: f64,
        mm_per_min: f64,
        in_per_min: f64,
        mm_per_rev: f64,
        in_per_rev: f64,
        mm_per_tooth: f64,
        in_per_tooth: f64,
    }

    fn golden_units() -> GoldenUnits {
        serde_json::from_str(include_str!("../../../tests/fixtures/m1/units.golden.json"))
            .expect("units golden fixture")
    }

    fn approximately_equal(
        left: f64,
        right: f64,
        absolute_tolerance: f64,
        relative_tolerance: f64,
    ) -> bool {
        let absolute = (left - right).abs();
        let relative = absolute / left.abs().max(right.abs()).max(1.0);
        absolute <= absolute_tolerance || relative <= relative_tolerance
    }

    #[test]
    fn units_length_golden_round_trip() {
        let inches = millimeters_to_inches(25.4).expect("finite millimeters");
        assert!(approximately_equal(inches, 1.0, 1.0e-12, 1.0e-12));
        let millimeters = inches_to_millimeters(inches).expect("finite inches");
        assert!(approximately_equal(millimeters, 25.4, 1.0e-12, 1.0e-12));
    }

    #[test]
    fn units_angle_golden_round_trip() {
        let radians = degrees_to_radians(180.0).expect("finite degrees");
        assert!(approximately_equal(
            radians,
            std::f64::consts::PI,
            1.0e-12,
            1.0e-12
        ));
        let degrees = radians_to_degrees(radians).expect("finite radians");
        assert!(approximately_equal(degrees, 180.0, 1.0e-12, 1.0e-12));
    }

    #[test]
    fn units_feed_and_spindle_golden_round_trips() {
        let golden = golden_units();
        let feeds = golden.feeds;
        let absolute = golden.absolute_tolerance;
        let relative = golden.relative_tolerance;

        let in_per_min = millimeters_per_minute_to_inches_per_minute(feeds.mm_per_min)
            .expect("mm/min conversion");
        assert!(approximately_equal(
            in_per_min,
            feeds.in_per_min,
            absolute,
            relative
        ));
        assert!(approximately_equal(
            inches_per_minute_to_millimeters_per_minute(in_per_min).expect("in/min conversion"),
            feeds.mm_per_min,
            absolute,
            relative
        ));

        let in_per_rev = millimeters_per_revolution_to_inches_per_revolution(feeds.mm_per_rev)
            .expect("mm/rev conversion");
        assert!(approximately_equal(
            in_per_rev,
            feeds.in_per_rev,
            absolute,
            relative
        ));
        assert!(approximately_equal(
            inches_per_revolution_to_millimeters_per_revolution(in_per_rev)
                .expect("in/rev conversion"),
            feeds.mm_per_rev,
            absolute,
            relative
        ));

        let in_per_tooth = millimeters_per_tooth_to_inches_per_tooth(feeds.mm_per_tooth)
            .expect("mm/tooth conversion");
        assert!(approximately_equal(
            in_per_tooth,
            feeds.in_per_tooth,
            absolute,
            relative
        ));
        assert!(approximately_equal(
            inches_per_tooth_to_millimeters_per_tooth(in_per_tooth).expect("in/tooth conversion"),
            feeds.mm_per_tooth,
            absolute,
            relative
        ));

        let revolutions_per_second =
            revolutions_per_minute_to_revolutions_per_second(feeds.rpm).expect("rpm conversion");
        assert!(approximately_equal(
            revolutions_per_second,
            100.0,
            absolute,
            relative
        ));
        assert!(approximately_equal(
            revolutions_per_second_to_revolutions_per_minute(revolutions_per_second)
                .expect("rev/s conversion"),
            feeds.rpm,
            absolute,
            relative
        ));
    }

    #[test]
    fn units_positive_quantities_reject_invalid_values() {
        assert!(LengthMm::try_new(-1.0).is_err());
        assert!(FeedMmPerMin::try_new(0.0).is_err());
        assert!(SpindleSpeedRpm::try_new(f64::INFINITY).is_err());
    }

    #[test]
    fn units_negative_zero_is_rejected() {
        let error = CoordinateMm::try_new(-0.0).expect_err("negative zero must fail");
        assert_eq!(error.code, "number.negative_zero");
        assert!(millimeters_to_inches(-0.0).is_err());
        assert!(round_for_display(-0.0, 3).is_err());
    }

    #[test]
    fn units_display_rounding_does_not_mutate_internal_precision() {
        let internal = 12.345_678_901_234_5;
        let displayed = round_for_display(internal, 3).expect("finite value");
        assert_eq!(displayed, 12.346);
        assert_eq!(internal, 12.345_678_901_234_5);
    }
}
