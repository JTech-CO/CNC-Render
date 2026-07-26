#![forbid(unsafe_code)]

/// Human-readable product name used across CNC Render components.
pub const PRODUCT_NAME: &str = "CNC Render";

/// Stable machine-readable identifier for the CNC Render product.
pub const PRODUCT_ID: &str = "cnc-render";

#[cfg(test)]
mod tests {
    use super::{PRODUCT_ID, PRODUCT_NAME};

    #[test]
    fn product_identity_is_stable() {
        assert_eq!(PRODUCT_NAME, "CNC Render");
        assert_eq!(PRODUCT_ID, "cnc-render");
    }
}
