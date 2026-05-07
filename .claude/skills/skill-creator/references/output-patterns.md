# Output Patterns

Patterns for ensuring consistent, high-quality skill output.

## Template Pattern

Provides structural guidance for output formats. Choose strictness based on requirements:

### Strict Approach
Use for API responses, data formats, and outputs requiring precision:

```markdown
## Output Format

ALWAYS use this exact template structure:

```json
{
  "status": "success|error",
  "data": { ... },
  "timestamp": "ISO 8601 format"
}
```
```

### Flexible Approach
Suggest defaults while allowing adaptation:

```markdown
## Output Format

Use this structure as a sensible default, adapting based on discovered content:

- **Header**: Brief summary
- **Body**: Detailed content (expand sections as needed)
- **Footer**: References or next steps
```

## Examples Pattern

Use input/output pairs to demonstrate desired quality. Examples communicate expectations more effectively than descriptions alone.

### When to Use Examples

- Clarifying preferred style and tone
- Showing appropriate detail levels
- Demonstrating formatting conventions
- Illustrating edge case handling

### Example Structure

```markdown
## Examples

### Example 1: Basic Usage

**Input:**
> Create a greeting for a morning standup

**Output:**
Good morning, team! Let's sync up on our progress and blockers.

### Example 2: Formal Context

**Input:**
> Create a greeting for a client presentation

**Output:**
Good morning. Thank you for joining us today. We're excited to share our progress with you.
```

## Combining Patterns

For complex skills, combine templates with examples:

```markdown
## Output Format

Use this structure:

1. **Summary** (1-2 sentences)
2. **Details** (bulleted list)
3. **Next Steps** (if applicable)

### Example

**Input:** Summarize the API changes

**Output:**
**Summary:** We've added three new endpoints and deprecated one.

**Details:**
- Added: `/users/preferences`, `/users/notifications`, `/users/export`
- Deprecated: `/users/settings` (use `/users/preferences` instead)

**Next Steps:**
- Update client SDK by March 1st
- Migrate existing `/settings` calls
```
