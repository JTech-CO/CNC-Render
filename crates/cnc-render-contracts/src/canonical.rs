use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};

use crate::validation::{ContractError, ContractResult};

pub fn canonical_json(value: &Value) -> ContractResult<String> {
    let normalized = normalize_value(value, "$")?;
    serde_jcs::to_string(&normalized)
        .map_err(|error| ContractError::new("canonical.serialize", "$", error.to_string()))
}

pub fn semantic_hash(value: &Value) -> ContractResult<String> {
    let canonical = canonical_json(value)?;
    let digest = Sha256::digest(canonical.as_bytes());
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn normalize_value(value: &Value, path: &str) -> ContractResult<Value> {
    match value {
        Value::Number(number) => {
            let Some(value) = number.as_f64() else {
                return Err(ContractError::new(
                    "number.invalid",
                    path,
                    "canonical JSON numbers must be representable as IEEE 754 doubles",
                ));
            };
            if !value.is_finite() {
                return Err(ContractError::new(
                    "number.not_finite",
                    path,
                    "canonical JSON accepts finite numbers only",
                ));
            }
            if value == 0.0 && value.is_sign_negative() {
                return Err(ContractError::new(
                    "number.negative_zero",
                    path,
                    "canonical JSON rejects negative zero",
                ));
            }
            let number = Number::from_f64(value).ok_or_else(|| {
                ContractError::new(
                    "number.invalid",
                    path,
                    "canonical JSON could not normalize the number",
                )
            })?;
            Ok(Value::Number(number))
        }
        Value::Array(values) => values
            .iter()
            .enumerate()
            .map(|(index, item)| normalize_value(item, &format!("{path}[{index}]")))
            .collect::<ContractResult<Vec<_>>>()
            .map(Value::Array),
        Value::Object(object) => object
            .iter()
            .map(|(key, item)| {
                normalize_value(item, &format!("{path}.{key}"))
                    .map(|normalized| (key.clone(), normalized))
            })
            .collect::<ContractResult<Map<_, _>>>()
            .map(Value::Object),
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(value.clone()),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{canonical_json, semantic_hash};

    #[test]
    fn schema_canonical_json_sorts_keys_and_preserves_array_order() {
        let value = json!({
            "z": [3, 2, 1],
            "a": {
                "second": true,
                "first": null
            }
        });

        assert_eq!(
            canonical_json(&value).expect("canonical JSON"),
            r#"{"a":{"first":null,"second":true},"z":[3,2,1]}"#,
        );
    }

    #[test]
    fn schema_canonical_json_uses_ecmascript_number_boundaries() {
        let value: Value =
            serde_json::from_str(r#"{"threshold":0.000001,"small":0.0000001,"large":1e21}"#)
                .expect("boundary JSON");

        assert_eq!(
            canonical_json(&value).expect("canonical JSON"),
            r#"{"large":1e+21,"small":1e-7,"threshold":0.000001}"#,
        );
    }

    #[test]
    fn schema_canonical_json_normalizes_unsafe_integers_to_double_semantics() {
        let value: Value = serde_json::from_str("9007199254740993").expect("unsafe integer JSON");
        assert_eq!(
            canonical_json(&value).expect("canonical JSON"),
            "9007199254740992",
        );
    }

    #[test]
    fn schema_canonical_json_rejects_negative_zero() {
        let negative_zero: Value = serde_json::from_str("-0.0").expect("negative zero JSON");
        let error = canonical_json(&negative_zero).expect_err("negative zero must fail");
        assert_eq!(error.code, "number.negative_zero");
    }

    #[test]
    fn schema_semantic_hash_is_deterministic() {
        let first = json!({"b": 2, "a": 1});
        let second = json!({"a": 1, "b": 2});
        assert_eq!(
            semantic_hash(&first).expect("first hash"),
            semantic_hash(&second).expect("second hash"),
        );
    }
}
