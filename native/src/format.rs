use napi::Result;
use serde_json::Value;
use std::collections::HashMap;

/// Escape Discord markdown chars: \ * _ [ ] ( ) `
#[napi(js_name = "escapeMarkdown")]
pub fn escape_markdown(text: String) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for c in text.chars() {
        if matches!(c, '\\' | '*' | '_' | '[' | ']' | '(' | ')' | '`') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// JS String.prototype.slice semantics in UTF-16 code units.
#[napi(js_name = "truncate")]
pub fn truncate(s: String, max_length: u32, suffix: Option<String>) -> String {
    let suffix = suffix.unwrap_or_else(|| "...".into());
    let units: Vec<u16> = s.encode_utf16().collect();
    if units.len() <= max_length as usize {
        return s;
    }
    let keep = max_length
        .saturating_sub(suffix.encode_utf16().count() as u32) as usize;
    let mut out = String::from_utf16_lossy(&units[..keep.min(units.len())]);
    out.push_str(&suffix);
    out
}

/// Number(value).toLocaleString("en-US") — thousands grouping, up to 3
/// fraction digits.
#[napi(js_name = "formatNumber")]
pub fn format_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }

    // toLocaleString default: maximumFractionDigits = 3, half-expand.
    let negative = value.is_sign_negative() && value != 0.0;
    let milli = (value.abs() * 1000.0).round() as u64;
    let int_part = milli / 1000;
    let frac_part = milli % 1000;

    let digits = int_part.to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }

    let mut out = String::new();
    if negative {
        out.push('-');
    }
    out.push_str(&grouped);
    if frac_part > 0 {
        let frac = format!("{frac_part:03}");
        out.push('.');
        out.push_str(frac.trim_end_matches('0'));
    }
    out
}

/// "█".repeat(filled) + "░".repeat(empty), Math.round for the fill count.
#[napi(js_name = "renderProgressBar")]
pub fn render_progress_bar(percent: f64, length: Option<u32>) -> String {
    let length = length.unwrap_or(10) as i64;
    let filled = ((percent / 100.0) * length as f64 + 0.5).floor() as i64;
    let empty = length - filled;
    "█".repeat(filled.max(0) as usize) + &"░".repeat(empty.max(0) as usize)
}

/// {key} placeholder expansion — replaces {[a-zA-Z0-9._]+} with the
/// case-insensitively-matched value, leaving unknown placeholders intact.
#[napi(js_name = "replacePlaceholders")]
pub fn replace_placeholders(text: String, values: Value) -> Result<String> {
    let map: HashMap<String, String> = match &values {
        Value::Object(obj) => obj
            .iter()
            .map(|(k, v)| (k.to_lowercase(), crate::quest::js_string(v)))
            .collect(),
        _ => HashMap::new(),
    };

    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '{' {
            let mut j = i + 1;
            while j < chars.len()
                && (chars[j].is_ascii_alphanumeric() || chars[j] == '.' || chars[j] == '_')
            {
                j += 1;
            }
            if j < chars.len() && chars[j] == '}' && j > i + 1 {
                let key: String = chars[i + 1..j].iter().collect::<String>().to_lowercase();
                if let Some(v) = map.get(&key) {
                    out.push_str(v);
                    i = j + 1;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    Ok(out)
}
