use napi::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

// =========================================================
// AST — mirrors the node shapes produced by questEngine.js
// =========================================================

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Ast {
    If { condition: Box<Ast>, #[serde(rename = "taskName")] task_name: String },
    Execute { #[serde(rename = "taskName")] task_name: String },
    Or { left: Box<Ast>, right: Box<Ast> },
    And { left: Box<Ast>, right: Box<Ast> },
    Not { expr: Box<Ast> },
    Variable { name: String },
    Literal { value: Value },
    Entity { entity: String },
    Field { entity: String, field: String },
    Compare { entity: String, field: String, op: String, value: Box<Ast> },
    Method { entity: String, field: String, arg: Box<Ast> },
}

// =========================================================
// Tokenizer — port of the regex-driven tokenize() in JS
// =========================================================

fn is_word_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

pub fn tokenize(input: &str) -> Vec<String> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        // Quoted string: "(\\"|[^"])*" or '(\\'|[^'])*'
        if c == '"' || c == '\'' {
            let mut j = i + 1;
            let mut closed = false;
            while j < chars.len() {
                if chars[j] == '\\' && j + 1 < chars.len() && chars[j + 1] == c {
                    j += 2;
                    continue;
                }
                if chars[j] == c {
                    closed = true;
                    j += 1;
                    break;
                }
                j += 1;
            }
            if closed {
                tokens.push(chars[i..j].iter().collect());
                i = j;
            } else {
                // Unterminated string: the regex falls back to \S — the bare quote.
                tokens.push(c.to_string());
                i += 1;
            }
            continue;
        }

        // Two-char operators before single-char.
        if i + 1 < chars.len() {
            let two: String = chars[i..i + 2].iter().collect();
            if matches!(two.as_str(), ">=" | "<=" | "!=" | "==") {
                tokens.push(two);
                i += 2;
                continue;
            }
        }
        if matches!(c, '=' | '<' | '>' | '&' | '|' | '!' | '(' | ')' | ',' | '.') {
            tokens.push(c.to_string());
            i += 1;
            continue;
        }

        // $variable
        if c == '$' && i + 1 < chars.len() && is_word_start(chars[i + 1]) {
            let mut j = i + 2;
            while j < chars.len() && is_word_char(chars[j]) {
                j += 1;
            }
            tokens.push(chars[i..j].iter().collect());
            i = j;
            continue;
        }

        // identifier
        if is_word_start(c) {
            let mut j = i + 1;
            while j < chars.len() && is_word_char(chars[j]) {
                j += 1;
            }
            tokens.push(chars[i..j].iter().collect());
            i = j;
            continue;
        }

        // number: \d+\.?\d*
        if c.is_ascii_digit() {
            let mut j = i;
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            if j < chars.len() && chars[j] == '.' {
                j += 1;
                while j < chars.len() && chars[j].is_ascii_digit() {
                    j += 1;
                }
            }
            tokens.push(chars[i..j].iter().collect());
            i = j;
            continue;
        }

        // \S fallback: single char token
        tokens.push(c.to_string());
        i += 1;
    }

    tokens
}

// =========================================================
// Parser — recursive descent, same grammar as JS
// =========================================================

const OPERATORS: &[&str] = &[">=", "<=", "!=", "=", "<", ">", "==", "INCLUDE", "STARTS_WITH", "ENDS_WITH"];

struct Parser<'a> {
    tokens: &'a [String],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&str> {
        self.tokens.get(self.pos).map(|s| s.as_str())
    }

    fn next(&mut self) -> Option<String> {
        let t = self.tokens.get(self.pos).cloned();
        self.pos += 1;
        t
    }

    fn consume(&mut self, expected: &str) -> std::result::Result<String, String> {
        let t = self.next().unwrap_or_else(|| "undefined".into());
        if t != expected {
            return Err(format!("Expected {expected}, got {t}"));
        }
        Ok(t)
    }

    fn parse_statement(&mut self) -> std::result::Result<Ast, String> {
        match self.peek() {
            Some("IF") => {
                self.next();
                let condition = self.parse_condition()?;
                if self.peek() == Some(",") {
                    self.next();
                }
                self.consume("EXECUTE")?;
                self.consume("TASK")?;
                let task_name = self.next().ok_or("Expected task name, got undefined")?;
                Ok(Ast::If { condition: Box::new(condition), task_name })
            }
            Some("EXECUTE") => {
                self.next();
                self.consume("TASK")?;
                let task_name = self.next().ok_or("Expected task name, got undefined")?;
                Ok(Ast::Execute { task_name })
            }
            other => Err(format!("Unexpected statement: {}", other.unwrap_or("undefined"))),
        }
    }

    fn parse_condition(&mut self) -> std::result::Result<Ast, String> {
        self.parse_or()
    }

    fn parse_or(&mut self) -> std::result::Result<Ast, String> {
        let mut left = self.parse_and()?;
        while matches!(self.peek(), Some("|") | Some("OR")) {
            self.next();
            let right = self.parse_and()?;
            left = Ast::Or { left: Box::new(left), right: Box::new(right) };
        }
        Ok(left)
    }

    fn parse_and(&mut self) -> std::result::Result<Ast, String> {
        let mut left = self.parse_not()?;
        while matches!(self.peek(), Some("&") | Some("AND")) {
            self.next();
            let right = self.parse_not()?;
            left = Ast::And { left: Box::new(left), right: Box::new(right) };
        }
        Ok(left)
    }

    fn parse_not(&mut self) -> std::result::Result<Ast, String> {
        if matches!(self.peek(), Some("!") | Some("NOT")) {
            self.next();
            return Ok(Ast::Not { expr: Box::new(self.parse_not()?) });
        }
        self.parse_atom()
    }

    fn parse_atom(&mut self) -> std::result::Result<Ast, String> {
        let Some(t) = self.peek().map(|s| s.to_string()) else {
            return Err("Unexpected token: undefined".into());
        };

        if t == "(" {
            self.next();
            let expr = self.parse_condition()?;
            self.consume(")")?;
            return Ok(expr);
        }

        if t.starts_with('$') {
            self.next();
            return Ok(Ast::Variable { name: t[1..].to_string() });
        }

        if t.starts_with('"') || t.starts_with('\'') {
            self.next();
            let inner = if t.len() >= 2 { t[1..t.len() - 1].to_string() } else { String::new() };
            return Ok(Ast::Literal { value: Value::String(inner) });
        }

        if t.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            self.next();
            let n: f64 = t.parse().unwrap_or(f64::NAN);
            return Ok(Ast::Literal { value: json!(n) });
        }

        if t == "true" || t == "false" {
            self.next();
            return Ok(Ast::Literal { value: Value::Bool(t == "true") });
        }

        if t.chars().next().is_some_and(is_word_start) {
            let entity = self.next().unwrap();
            if self.peek() == Some(".") {
                self.next();
                let field = self.next().ok_or("Expected field, got undefined")?;

                if self.peek().is_some_and(|p| OPERATORS.contains(&p)) {
                    let op = self.next().unwrap();
                    let value = self.parse_atom()?;
                    return Ok(Ast::Compare {
                        entity,
                        field,
                        op,
                        value: Box::new(value),
                    });
                }

                // Method call lookahead: next token starts a value.
                let starts_value = self.peek().is_some_and(|n| {
                    n.starts_with('"')
                        || n.starts_with('\'')
                        || n.chars().next().is_some_and(|c| c.is_ascii_digit())
                        || n == "true"
                        || n == "false"
                        || n.starts_with('$')
                        || n.chars().next().is_some_and(is_word_start)
                });
                if starts_value {
                    let arg = self.parse_atom()?;
                    return Ok(Ast::Method { entity, field, arg: Box::new(arg) });
                }

                return Ok(Ast::Field { entity, field });
            }
            return Ok(Ast::Entity { entity });
        }

        Err(format!("Unexpected token: {t}"))
    }
}

// =========================================================
// AST cache — avoids re-parsing DSL per message per quest
// =========================================================

fn ast_cache() -> &'static Mutex<HashMap<String, Arc<Ast>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<Ast>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_parse_dsl(dsl: &str) -> std::result::Result<Arc<Ast>, String> {
    {
        let cache = ast_cache().lock().unwrap();
        if let Some(ast) = cache.get(dsl) {
            return Ok(ast.clone());
        }
    }
    let tokens = tokenize(dsl);
    let mut parser = Parser { tokens: &tokens, pos: 0 };
    let ast = Arc::new(parser.parse_statement()?);
    let mut cache = ast_cache().lock().unwrap();
    if cache.len() >= 512 {
        cache.clear();
    }
    cache.insert(dsl.to_string(), ast.clone());
    Ok(ast)
}

// =========================================================
// Block-condition builder (quest.condition JSON → AST)
// =========================================================

fn json_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn build_group(group: &Value) -> Option<Ast> {
    let blocks = group.get("blocks")?.as_array()?;
    if blocks.is_empty() {
        return None;
    }
    let asts: Vec<Ast> = blocks.iter().filter_map(build_condition_block).collect();
    if asts.is_empty() {
        return None;
    }
    if asts.len() == 1 {
        return Some(asts.into_iter().next().unwrap());
    }
    let is_any = group.get("match").and_then(Value::as_str) == Some("any");
    let mut iter = asts.into_iter();
    let mut root = iter.next().unwrap();
    for b in iter {
        root = if is_any {
            Ast::Or { left: Box::new(root), right: Box::new(b) }
        } else {
            Ast::And { left: Box::new(root), right: Box::new(b) }
        };
    }
    Some(root)
}

fn to_ast_value(v: &Value) -> Ast {
    match v {
        Value::String(s) if s.starts_with('$') => Ast::Variable { name: s[1..].to_string() },
        _ => Ast::Literal { value: v.clone() },
    }
}

fn build_condition_block(block: &Value) -> Option<Ast> {
    // Nested group: block.match && block.blocks (both truthy in JS).
    if json_truthy(block.get("match")) && block.get("blocks").is_some_and(|b| b.is_array()) {
        let inner = build_group(block)?;
        return Some(if json_truthy(block.get("not")) {
            Ast::Not { expr: Box::new(inner) }
        } else {
            inner
        });
    }

    let entity = block.get("entity").and_then(Value::as_str).filter(|s| !s.is_empty())?;
    let field = block.get("field").and_then(Value::as_str).filter(|s| !s.is_empty())?;

    const METHOD_OPS: &[&str] = &["has_role", "has_any_role", "in_channel"];
    let op_is_method = block
        .get("op")
        .and_then(Value::as_str)
        .is_some_and(|op| METHOD_OPS.contains(&op));
    let field_is_method = METHOD_OPS.contains(&field);

    let arg = to_ast_value(block.get("value").unwrap_or(&Value::Null));
    let leaf = if op_is_method || field_is_method {
        Ast::Method {
            entity: entity.into(),
            field: field.into(),
            arg: Box::new(arg),
        }
    } else {
        Ast::Compare {
            entity: entity.into(),
            field: field.into(),
            op: block.get("op").and_then(Value::as_str).unwrap_or("").into(),
            value: Box::new(arg),
        }
    };

    Some(if json_truthy(block.get("not")) {
        Ast::Not { expr: Box::new(leaf) }
    } else {
        leaf
    })
}

// =========================================================
// JS value semantics helpers
// =========================================================

fn js_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

fn js_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => *b as i64 as f64,
        Value::Number(n) => n.as_f64().map(|f| if f.is_nan() { 0.0 } else { f }).unwrap_or(0.0),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
                i64::from_str_radix(hex, 16).map(|i| i as f64).unwrap_or(0.0)
            } else {
                t.parse::<f64>().unwrap_or(0.0)
            }
        }
        _ => 0.0,
    }
}

pub(crate) fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => {
            let f = n.as_f64().unwrap_or(f64::NAN);
            if f.is_nan() {
                "NaN".into()
            } else if f.is_infinite() {
                if f > 0.0 { "Infinity".into() } else { "-Infinity".into() }
            } else {
                format!("{f}")
            }
        }
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// JS loose equality (==) for the JSON value subset we handle.
fn js_loose_eq(a: &Value, b: &Value) -> bool {
    use Value::*;
    match (a, b) {
        (Null, Null) => true,
        (Null, _) | (_, Null) => false,
        (Bool(x), Bool(y)) => x == y,
        (Number(x), Number(y)) => x.as_f64() == y.as_f64(),
        (String(x), String(y)) => x == y,
        (Number(_), String(_)) | (String(_), Number(_)) => js_number(a) == js_number(b),
        (Bool(_), _) => js_loose_eq(&json!(js_number(a)), b),
        (_, Bool(_)) => js_loose_eq(a, &json!(js_number(b))),
        _ => false,
    }
}

/// JS strict equality (===) — same type required.
fn js_strict_eq(a: &Value, b: &Value) -> bool {
    use Value::*;
    match (a, b) {
        (Null, Null) => true,
        (Bool(x), Bool(y)) => x == y,
        (Number(x), Number(y)) => x.as_f64() == y.as_f64(),
        (String(x), String(y)) => x == y,
        _ => false,
    }
}

/// `counters[key] || 0` — truthy values pass through, else 0.
fn counter_or_zero(counters: &Map<String, Value>, key: &str) -> Value {
    match counters.get(key) {
        Some(v) if js_truthy(v) => v.clone(),
        _ => json!(0),
    }
}

fn nested_counter(counters: &Map<String, Value>, outer: &str, key: &str) -> Value {
    match counters.get(outer).and_then(Value::as_object) {
        Some(obj) => counter_or_zero(obj, key),
        None => json!(0),
    }
}

// =========================================================
// Entity field + method resolution — ported from JS
// =========================================================

fn get_entity_field(entity: &str, field: &str, ctx: &Value) -> Value {
    let counters = ctx
        .get("counters")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    match entity {
        "message" => {
            let msg = ctx.get("message");
            match field {
                "content" => msg.and_then(|m| m.get("content")).cloned().map_or(json!(""), |v| v),
                "channel" => msg.and_then(|m| m.get("channelId")).cloned().unwrap_or(Value::Null),
                "author" => msg.and_then(|m| m.get("authorId")).cloned().unwrap_or(Value::Null),
                "guild" => msg.and_then(|m| m.get("guildId")).cloned().unwrap_or(Value::Null),
                "attachments" => msg.and_then(|m| m.get("attachments")).cloned().unwrap_or(json!(0)),
                _ => Value::Null,
            }
        }
        "messages" => match field {
            "sent" => counter_or_zero(&counters, "messagesSent"),
            "in_channel" => nested_counter(
                &counters,
                "messagesInChannel",
                ctx.get("channelId").and_then(Value::as_str).unwrap_or(""),
            ),
            "with_content" => nested_counter(
                &counters,
                "messagesWithContent",
                ctx.get("keyword").and_then(Value::as_str).unwrap_or(""),
            ),
            _ => Value::Null,
        },
        "user" => {
            let Some(user) = ctx.get("user") else {
                return Value::Null;
            };
            match field {
                "id" => user.get("id").cloned().unwrap_or(Value::Null),
                "username" => user.get("username").cloned().unwrap_or(Value::Null),
                "display_name" => user.get("displayName").cloned().unwrap_or(Value::Null),
                "is_bot" => user.get("isBot").cloned().unwrap_or(json!(false)),
                "boosted" => user.get("boosted").cloned().unwrap_or(json!(false)),
                _ => Value::Null,
            }
        }
        "voice" => match field {
            "minutes" => json!((js_number(&counter_or_zero(&counters, "voiceSeconds")) / 60.0).floor()),
            "joined" => counter_or_zero(&counters, "voiceJoined"),
            _ => Value::Null,
        },
        "invites" => match field {
            "count" => counter_or_zero(&counters, "invites"),
            _ => Value::Null,
        },
        "commands" => match field {
            "count" => counter_or_zero(&counters, "commandsUsed"),
            "used" => nested_counter(
                &counters,
                "commandsUsedList",
                ctx.get("commandName").and_then(Value::as_str).unwrap_or(""),
            ),
            _ => Value::Null,
        },
        "reactions" => match field {
            "count" => counter_or_zero(&counters, "reactionsAdded"),
            _ => Value::Null,
        },
        "economy" => {
            let eco = ctx.get("economy");
            match field {
                "primary" => eco.and_then(|e| e.get("primary")).cloned().map_or(json!(0), |v| if js_truthy(&v) { v } else { json!(0) }),
                "secondary" => eco.and_then(|e| e.get("secondary")).cloned().map_or(json!(0), |v| if js_truthy(&v) { v } else { json!(0) }),
                _ => Value::Null,
            }
        }
        "channel" => match field {
            "message" => ctx
                .get("message")
                .and_then(|m| m.get("content"))
                .cloned()
                .unwrap_or(json!("")),
            "id" => ctx.get("channelId").cloned().unwrap_or(Value::Null),
            "name" => ctx
                .get("channelName")
                .cloned()
                .unwrap_or_else(|| ctx.get("channelId").cloned().unwrap_or(Value::Null)),
            _ => ctx.get("channelId").cloned().unwrap_or(Value::Null),
        },
        "guild" => ctx.get("guildId").cloned().unwrap_or(Value::Null),
        "progress" => counter_or_zero(&counters, field),
        _ => Value::Null,
    }
}

fn roles_of(ctx: &Value) -> Vec<String> {
    ctx.get("user")
        .and_then(|u| u.get("roles"))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default()
}

fn call_method(entity: &str, method: &str, arg: &Value, ctx: &Value) -> bool {
    let counters = ctx
        .get("counters")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    match entity {
        "user" => {
            if ctx.get("user").is_none() {
                return false;
            }
            let roles = roles_of(ctx);
            match method {
                "has_role" => arg.as_str().is_some_and(|s| roles.iter().any(|r| r == s)),
                "has_any_role" => {
                    let ids: Vec<String> = match arg {
                        Value::Array(a) => a.iter().filter_map(Value::as_str).map(str::to_string).collect(),
                        _ => js_split_runs(&js_string(arg)).into_iter().filter(|s| !s.is_empty()).collect(),
                    };
                    ids.iter().any(|id| roles.iter().any(|r| r == id))
                }
                "in_channel" => js_strict_eq(
                    ctx.get("channelId").unwrap_or(&Value::Null),
                    arg,
                ),
                "sent_messages" => {
                    js_number(&counter_or_zero(&counters, "messagesSent")) >= js_number(arg)
                }
                _ => false,
            }
        }
        "message" => {
            let Some(msg) = ctx.get("message") else {
                return false;
            };
            match method {
                "content_include" | "content_starts_with" | "content_ends_with" => {
                    let content = js_string(msg.get("content").unwrap_or(&Value::Null))
                        .to_lowercase();
                    let needle = js_string(arg).to_lowercase();
                    match method {
                        "content_include" => content.contains(&needle),
                        "content_starts_with" => content.starts_with(&needle),
                        _ => content.ends_with(&needle),
                    }
                }
                "in_channel" => js_strict_eq(
                    msg.get("channelId").unwrap_or(&Value::Null),
                    arg,
                ),
                _ => false,
            }
        }
        "messages" => match method {
            "in_channel" => {
                js_number(&nested_counter(&counters, "messagesInChannel", &js_string(arg))) >= 1.0
            }
            "with_content" => {
                js_number(&nested_counter(&counters, "messagesWithContent", &js_string(arg))) >= 1.0
            }
            "sent" => {
                js_number(&counter_or_zero(&counters, "messagesSent")) >= js_number(arg)
            }
            _ => false,
        },
        "voice" => match method {
            "minutes_at_least" => {
                (js_number(&counter_or_zero(&counters, "voiceSeconds")) / 60.0).floor()
                    >= js_number(arg)
            }
            _ => false,
        },
        "invites" => match method {
            "at_least" => {
                js_number(&counter_or_zero(&counters, "invites")) >= js_number(arg)
            }
            _ => false,
        },
        "commands" => match method {
            "used" => {
                js_number(&nested_counter(&counters, "commandsUsedList", &js_string(arg))) >= 1.0
            }
            "used_at_least" => {
                let parts = js_split_runs(&js_string(arg));
                let key = parts.first().map(String::as_str).unwrap_or("");
                let n = parts.get(1).map(|p| js_number(&json!(p))).unwrap_or(1.0);
                js_number(&nested_counter(&counters, "commandsUsedList", key)) >= n
            }
            _ => false,
        },
        _ => false,
    }
}

/// String(arg).split(/[,\s]+/) — split on runs of commas/whitespace,
/// preserving JS's leading-empty-element behavior.
fn js_split_runs(s: &str) -> Vec<String> {
    let is_delim = |c: char| c == ',' || c.is_whitespace();
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut in_run = false;
    for c in s.chars() {
        if is_delim(c) {
            if !in_run {
                parts.push(std::mem::take(&mut cur));
                in_run = true;
            }
        } else {
            cur.push(c);
            in_run = false;
        }
    }
    parts.push(cur);
    parts
}

// =========================================================
// Evaluation
// =========================================================

fn compare_values(left: &Value, op: &str, right: &Value) -> bool {
    match op {
        "=" | "==" => js_loose_eq(left, right),
        "!=" => !js_loose_eq(left, right),
        "INCLUDE" => js_string(left)
            .to_lowercase()
            .contains(&js_string(right).to_lowercase()),
        "STARTS_WITH" => js_string(left)
            .to_lowercase()
            .starts_with(&js_string(right).to_lowercase()),
        "ENDS_WITH" => js_string(left)
            .to_lowercase()
            .ends_with(&js_string(right).to_lowercase()),
        ">" => js_number(left) > js_number(right),
        "<" => js_number(left) < js_number(right),
        ">=" => js_number(left) >= js_number(right),
        "<=" => js_number(left) <= js_number(right),
        _ => false,
    }
}

fn resolve_value(node: &Ast, ctx: &Value) -> Value {
    match node {
        Ast::Literal { value } => value.clone(),
        Ast::Variable { name } => ctx
            .get("variables")
            .and_then(|v| v.get(name))
            .cloned()
            .unwrap_or(Value::Null),
        Ast::Entity { .. } => Value::Null,
        Ast::Field { entity, field } => get_entity_field(entity, field, ctx),
        Ast::Compare { entity, field, op, value } => {
            let left = get_entity_field(entity, field, ctx);
            let right = resolve_value(value, ctx);
            json!(compare_values(&left, op, &right))
        }
        Ast::Method { entity, field, arg } => {
            let arg_val = resolve_value(arg, ctx);
            json!(call_method(entity, field, &arg_val, ctx))
        }
        _ => Value::Null,
    }
}

fn evaluate(node: &Ast, ctx: &Value) -> bool {
    match node {
        Ast::And { left, right } => evaluate(left, ctx) && evaluate(right, ctx),
        Ast::Or { left, right } => evaluate(left, ctx) || evaluate(right, ctx),
        Ast::Not { expr } => !evaluate(expr, ctx),
        Ast::Compare { .. } | Ast::Method { .. } | Ast::Field { .. } => {
            js_truthy(&resolve_value(node, ctx))
        }
        Ast::Literal { value } => js_truthy(value),
        _ => false,
    }
}

// =========================================================
// napi exports
// =========================================================

fn build_condition_ast(condition: Option<&Value>, dsl: Option<&str>) -> std::result::Result<Option<Arc<Ast>>, String> {
    let has_blocks = condition
        .and_then(|c| c.get("blocks"))
        .and_then(Value::as_array)
        .is_some_and(|a| !a.is_empty());

    if !has_blocks {
        let Some(dsl) = dsl else {
            return Ok(None);
        };
        let statement = cached_parse_dsl(dsl)?;
        return Ok(match &*statement {
            Ast::If { condition, .. } => Some(Arc::new((**condition).clone())),
            _ => None,
        });
    }

    let condition = condition.expect("has_blocks implies condition is Some");
    let key = format!("cond:{}", serde_json::to_string(condition).unwrap_or_default());
    {
        let cache = ast_cache().lock().unwrap();
        if let Some(ast) = cache.get(&key) {
            return Ok(Some(ast.clone()));
        }
    }
    let built = build_group(condition).map(Arc::new);
    if let Some(ast) = &built {
        let mut cache = ast_cache().lock().unwrap();
        if cache.len() >= 512 {
            cache.clear();
        }
        cache.insert(key, ast.clone());
    }
    Ok(built)
}

/// Evaluate a quest condition.
/// - `dsl`: quest.dsl string (or null)
/// - `condition_json`: JSON-serialized quest.condition (or null)
/// - `context_json`: JSON-serialized normalized context built by questEngine.js
/// JSON strings beat napi object marshaling for repeated small payloads.
/// Returns { valid, result } — `valid` is false when no condition could be
/// built (matches the JS "has no valid condition" error path).
#[napi(js_name = "evalQuest")]
pub fn eval_quest(
    dsl: Option<String>,
    condition_json: Option<String>,
    context_json: String,
) -> Result<Value> {
    let condition: Option<Value> = match &condition_json {
        Some(s) => Some(
            serde_json::from_str(s)
                .map_err(|e| napi::Error::from_reason(format!("condition JSON: {e}")))?,
        ),
        None => None,
    };
    let context: Value = serde_json::from_str(&context_json)
        .map_err(|e| napi::Error::from_reason(format!("context JSON: {e}")))?;

    match build_condition_ast(condition.as_ref(), dsl.as_deref()) {
        Ok(Some(ast)) => Ok(json!({ "valid": true, "result": evaluate(&ast, &context) })),
        Ok(None) => Ok(json!({ "valid": false, "result": false })),
        Err(e) => Err(napi::Error::from_reason(e)),
    }
}

/// Debug helper matching JS testParse(): { tokens, ast }.
#[napi(js_name = "parseQuestDsl")]
pub fn parse_quest_dsl(dsl: String) -> Result<Value> {
    let tokens = tokenize(&dsl);
    let mut parser = Parser { tokens: &tokens, pos: 0 };
    let ast = parser
        .parse_statement()
        .map_err(napi::Error::from_reason)?;
    Ok(json!({ "tokens": tokens, "ast": ast }))
}
