# Workflow Patterns

Patterns for structuring multi-step Claude interactions.

## Sequential Workflows

For tasks with ordered steps, provide a clear overview early in documentation.

### Structure

```markdown
## Workflow Overview

1. **Analyze** - Understand the input
2. **Process** - Transform the data
3. **Generate** - Create output
4. **Verify** - Validate results
```

### Detailed Example: PDF Form Filling

```markdown
## PDF Form Workflow

### Stage 1: Document Analysis
- Read the PDF structure
- Identify form fields
- Extract field metadata (type, constraints)

### Stage 2: Data Mapping
- Match input data to form fields
- Validate data types
- Handle missing or optional fields

### Stage 3: Population
- Fill identified fields
- Apply formatting rules
- Handle special characters

### Stage 4: Validation
- Verify all required fields are filled
- Check for constraint violations
- Generate validation report

### Stage 5: Output
- Save the filled PDF
- Return success status with summary
```

## Conditional Workflows

For tasks with branching decisions, guide Claude through decision points.

### Structure

```markdown
## Decision Points

### Is this a new document or edit?

**If creating new:**
1. Generate template
2. Populate with provided content
3. Apply default styling

**If editing existing:**
1. Load current document
2. Identify sections to modify
3. Preserve unaffected content
4. Apply changes
```

### Detailed Example: Content Operations

```markdown
## Content Workflow

### Step 1: Determine Operation Type

Check the user's request:
- Contains "create", "new", "generate" → **Creation Path**
- Contains "edit", "update", "modify" → **Editing Path**
- Contains "review", "check", "analyze" → **Review Path**

---

### Creation Path

1. Gather requirements
   - Topic/subject
   - Target audience
   - Desired length
   - Tone/style

2. Generate outline
   - Main sections
   - Key points per section

3. Write content
   - Follow outline
   - Maintain consistent tone

4. Self-review
   - Check completeness
   - Verify accuracy

---

### Editing Path

1. Load existing content
   - Preserve original structure
   - Note current formatting

2. Identify changes
   - Specific sections to modify
   - Type of modification (add/remove/rewrite)

3. Apply changes
   - Maintain surrounding context
   - Match existing style

4. Highlight modifications
   - Show what changed
   - Explain reasoning if significant

---

### Review Path

1. Analyze content
   - Structure assessment
   - Clarity check
   - Accuracy verification

2. Generate feedback
   - Specific issues found
   - Suggested improvements
   - Priority ranking

3. Provide summary
   - Overall assessment
   - Key recommendations
```

## Loop Workflows

For iterative processes that repeat until a condition is met.

### Structure

```markdown
## Iteration Loop

1. **Initialize**: Set up initial state
2. **Process**: Perform the main operation
3. **Evaluate**: Check completion criteria
4. **Decide**:
   - If complete → Proceed to output
   - If not complete → Return to step 2 with adjustments
5. **Output**: Return final result
```

### Example: Refinement Loop

```markdown
## Code Refinement Workflow

### Loop Structure

1. **Generate initial solution**

2. **Evaluate solution:**
   - Does it compile? (if no → fix syntax)
   - Does it pass tests? (if no → fix logic)
   - Does it meet requirements? (if no → refine approach)
   - Is it optimized? (if no → improve performance)

3. **If all checks pass:**
   - Return final solution

4. **If any check fails:**
   - Apply fix for highest priority issue
   - Return to step 2

**Maximum iterations:** 5 (prevent infinite loops)
```

## Combining Patterns

Complex skills often combine multiple patterns:

```markdown
## Complex Document Workflow

### Phase 1: Analysis (Sequential)
1. Read input
2. Classify document type
3. Extract metadata

### Phase 2: Processing (Conditional)
Based on document type:
- **Report** → Generate executive summary
- **Code** → Add documentation
- **Data** → Create visualization

### Phase 3: Refinement (Loop)
Repeat until quality threshold met:
1. Generate output
2. Self-evaluate
3. Improve if needed

### Phase 4: Delivery (Sequential)
1. Format output
2. Add metadata
3. Return to user
```
