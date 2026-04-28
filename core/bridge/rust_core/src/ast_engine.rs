use pyo3::prelude::*;
use rayon::prelude::*;
use std::collections::HashSet;

#[pyclass]
pub struct NativeContextAnalyzer {
    pub reserved_keywords: HashSet<String>,
}

#[pymethods]
impl NativeContextAnalyzer {
    #[new]
    pub fn new() -> Self {
        let mut reserved_keywords = HashSet::new();
        let keywords = vec![
            "class", "def", "async", "import", "from", "return", "yield", "pass", "None", "True", "False"
        ];
        for k in keywords {
            reserved_keywords.insert(k.to_string());
        }

        NativeContextAnalyzer {
            reserved_keywords,
        }
    }

    /// Fast line-level structural anchor extraction using Rayon parallel iteration.
    /// Detects def/class/import lines via prefix matching (not full AST parsing).
    /// For full AST fidelity, use Python's ast module via ResonanceEngine fallback.
    pub fn extract_anchors(&self, source_code: &str) -> PyResult<Vec<(String, String)>> {
        let lines: Vec<&str> = source_code.lines().collect();
        
        // Use parallel windows processing
        let anchors: Vec<(String, String)> = lines.par_iter()
            .enumerate()
            .filter_map(|(idx, line)| {
                let trimmed = line.trim();
                
                if trimmed.starts_with("def ") || trimmed.starts_with("async def ") {
                    Some(("function_definition".to_string(), trimmed.to_string()))
                } else if trimmed.starts_with("class ") {
                    Some(("class_definition".to_string(), trimmed.to_string()))
                } else if trimmed.starts_with("import ") || trimmed.starts_with("from ") {
                    Some(("import_statement".to_string(), trimmed.to_string()))
                } else {
                    None
                }
            })
            .collect();
            
        Ok(anchors)
    }

    /// Super-fast compression stripping comments and whitespace concurrently.
    pub fn compress_context(&self, source_code: &str) -> PyResult<String> {
        let lines: Vec<&str> = source_code.lines().collect();

        let compressed: Vec<String> = lines.par_iter()
            .filter_map(|line| {
                let mut trimmed = line.trim();
                
                // Extremely fast comment strip
                if let Some(idx) = trimmed.find('#') {
                    trimmed = &trimmed[..idx];
                }
                
                trimmed = trimmed.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
            .collect();

        Ok(compressed.join("\n"))
    }
}
