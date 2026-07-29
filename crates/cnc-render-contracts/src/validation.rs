use std::fmt;

pub type ContractResult<T> = Result<T, ContractError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContractError {
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

impl ContractError {
    pub fn new(code: &'static str, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for ContractError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} at {}: {}",
            self.code, self.path, self.message
        )
    }
}

impl std::error::Error for ContractError {}

pub fn require_finite(value: f64, path: &str) -> ContractResult<f64> {
    if !value.is_finite() {
        return Err(ContractError::new(
            "number.not_finite",
            path,
            "value must be a finite number",
        ));
    }
    if value == 0.0 && value.is_sign_negative() {
        return Err(ContractError::new(
            "number.negative_zero",
            path,
            "value must not be negative zero",
        ));
    }
    Ok(value)
}

pub fn require_positive(value: f64, path: &str) -> ContractResult<f64> {
    require_finite(value, path)?;

    if value > 0.0 {
        Ok(value)
    } else {
        Err(ContractError::new(
            "number.not_positive",
            path,
            "value must be greater than zero",
        ))
    }
}

pub fn require_non_negative(value: f64, path: &str) -> ContractResult<f64> {
    require_finite(value, path)?;

    if value >= 0.0 {
        Ok(value)
    } else {
        Err(ContractError::new(
            "number.negative",
            path,
            "value must not be negative",
        ))
    }
}

pub fn require_ordered_range(
    minimum: f64,
    maximum: f64,
    home: f64,
    path: &str,
) -> ContractResult<()> {
    require_finite(minimum, &format!("{path}.min"))?;
    require_finite(maximum, &format!("{path}.max"))?;
    require_finite(home, &format!("{path}.home"))?;

    if minimum >= maximum {
        return Err(ContractError::new(
            "axis.range_reversed",
            path,
            "axis minimum must be less than maximum",
        ));
    }

    if home < minimum || home > maximum {
        return Err(ContractError::new(
            "axis.home_out_of_range",
            path,
            "axis home must be inside the inclusive axis range",
        ));
    }

    Ok(())
}
