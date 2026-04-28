use pyo3::prelude::*;
mod ast_engine;
use ast_engine::NativeContextAnalyzer;

/// A specialized 2026-SOTA Rust Extension Module for Zero-Copy AST parsing and Context minimization.
/// 
/// This module implements memory-safe structural traversal utilizing threaded `rayon` pipelines.
#[pymodule]
fn alloy_rust_core(_py: Python, m: &PyModule) -> PyResult<()> {
    m.add_class::<NativeContextAnalyzer>()?;
    Ok(())
}
