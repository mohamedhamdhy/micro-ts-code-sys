import fs from "fs";
import path from "path";
import { FileMetrics, Issue, Severity } from "../types";

export function detectFileLang(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
        ".ts": "TypeScript", ".tsx": "TypeScript",
        ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
        ".py": "Python",
        ".java": "Java",
        ".go": "Go",
        ".rs": "Rust",
        ".rb": "Ruby",
        ".php": "PHP",
        ".cs": "C#",
        ".cpp": "C++", ".cc": "C++", ".cxx": "C++",
        ".c": "C",
    };
    return map[ext] || "Unknown";
}

function calcCyclomatic(content: string): number {
    const patterns = [
        /\bif\b/g, /\belse\s+if\b/g, /\bwhile\b/g, /\bfor\b/g,
        /\bforeach\b/g, /\bcase\b/g, /\bcatch\b/g, /\b&&\b/g, /\b\|\|\b/g,
        /\?\s*[^:]/g, // ternary
    ];
    let count = 1;
    for (const p of patterns) {
        const matches = content.match(p);
        if (matches) count += matches.length;
    }
    return Math.min(count, 999);
}

function calcCognitive(lines: string[]): number {
    let score = 0;
    let depth = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^\s*(if|else if|while|for|foreach|switch)\s*[({]/.test(line)) {
            score += 1 + depth;
            depth++;
        } else if (/^\s*else\b/.test(trimmed)) {
            score += 1;
        } else if (/^\s*(catch|finally)\b/.test(trimmed)) {
            score += 1;
        }
        if (trimmed.endsWith("}") || trimmed === "}") {
            depth = Math.max(0, depth - 1);
        }
    }
    return score;
}

function calcMaxNesting(lines: string[]): number {
    let depth = 0;
    let max = 0;
    for (const line of lines) {
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        depth += opens - closes;
        if (depth > max) max = depth;
        if (depth < 0) depth = 0;
    }
    return max;
}

function calcMaxFunctionLength(lines: string[]): number {
    const funcRegex = /\b(function|def|func|fn)\b.*[({]/;
    let inFunc = false;
    let funcStart = 0;
    let depth = 0;
    let maxLen = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!inFunc && funcRegex.test(line)) {
            inFunc = true;
            funcStart = i;
            depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        } else if (inFunc) {
            depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            if (depth <= 0) {
                const len = i - funcStart;
                if (len > maxLen) maxLen = len;
                inFunc = false;
                depth = 0;
            }
        }
    }
    return maxLen;
}

function countFunctions(content: string, lang: string): number {
    const patterns: Record<string, RegExp[]> = {
        "TypeScript": [/\bfunction\s+\w+/g, /\b\w+\s*[:=]\s*\(.*\)\s*(=>|:)/g, /\b(async\s+)?\w+\s*\(.*\)\s*\{/g],
        "JavaScript": [/\bfunction\s+\w+/g, /\b\w+\s*[:=]\s*\(.*\)\s*(=>|:)/g],
        "Python": [/\bdef\s+\w+/g],
        "Java": [/\b(public|private|protected|static)\b.*\w+\s*\(.*\)\s*\{/g],
        "Go": [/\bfunc\s+\w+/g],
        "Rust": [/\bfn\s+\w+/g],
    };
    const pats = patterns[lang] || patterns["JavaScript"];
    let count = 0;
    for (const p of pats) {
        const m = content.match(p);
        if (m) count += m.length;
    }
    return Math.max(count, 0);
}

function countClasses(content: string): number {
    const m = content.match(/\bclass\s+\w+/g);
    return m ? m.length : 0;
}

function countDuplicateBlocks(lines: string[]): number {
    const windowSize = 6;
    const seen = new Map<string, number>();
    let dups = 0;
    for (let i = 0; i <= lines.length - windowSize; i++) {
        const block = lines.slice(i, i + windowSize)
            .map(l => l.trim())
            .filter(l => l.length > 2 && !l.startsWith("//") && !l.startsWith("#"))
            .join("\n");
        if (block.length < 50) continue;
        const prev = seen.get(block);
        if (prev !== undefined && i - prev > windowSize) {
            dups++;
        } else {
            seen.set(block, i);
        }
    }
    return dups;
}

function detectIssues(
    lines: string[],
    content: string,
    filePath: string,
    lang: string,
    metrics: Partial<FileMetrics>
): Issue[] {
    const issues: Issue[] = [];
    const relPath = filePath;

    if ((metrics.codeLines || 0) > 300) {
        issues.push({
            file: relPath, type: "Large File", severity: "warning",
            description: `File has ${metrics.codeLines} lines of code (threshold: 300).`,
            suggestion: "Split into smaller, focused modules. Each file should have a single responsibility.",
        });
    }

    if ((metrics.cyclomaticComplexity || 0) > 20) {
        issues.push({
            file: relPath, type: "High Cyclomatic Complexity", severity: "critical",
            description: `Cyclomatic complexity is ${metrics.cyclomaticComplexity} (threshold: 20). Too many decision branches.`,
            suggestion: "Extract complex conditions into named functions. Use early returns and guard clauses.",
        });
    } else if ((metrics.cyclomaticComplexity || 0) > 10) {
        issues.push({
            file: relPath, type: "Moderate Complexity", severity: "warning",
            description: `Cyclomatic complexity is ${metrics.cyclomaticComplexity} (threshold: 10).`,
            suggestion: "Consider simplifying conditional logic and extracting methods.",
        });
    }

    if ((metrics.cognitiveComplexity || 0) > 15) {
        issues.push({
            file: relPath, type: "High Cognitive Complexity", severity: "warning",
            description: `Cognitive complexity score is ${metrics.cognitiveComplexity}. Hard to read and understand.`,
            suggestion: "Break down deeply nested logic. Use strategy pattern or early returns.",
        });
    }

    if ((metrics.maxFunctionLength || 0) > 50) {
        issues.push({
            file: relPath, type: "Long Function", severity: "warning",
            description: `Longest function is ${metrics.maxFunctionLength} lines (threshold: 50).`,
            suggestion: "Apply the Single Responsibility Principle — break into smaller focused functions.",
        });
    }

    if ((metrics.maxNestingDepth || 0) > 4) {
        issues.push({
            file: relPath, type: "Deep Nesting", severity: "warning",
            description: `Maximum nesting depth is ${metrics.maxNestingDepth} levels (threshold: 4).`,
            suggestion: "Use early returns, guard clauses, or extract nested logic into helper functions.",
        });
    }

    if ((metrics.duplicateBlocks || 0) > 2) {
        issues.push({
            file: relPath, type: "Code Duplication", severity: "warning",
            description: `Found ${metrics.duplicateBlocks} duplicate code blocks.`,
            suggestion: "Extract duplicated logic into shared utility functions or classes.",
        });
    }

    if ((metrics.functions || 0) > 20 && (metrics.codeLines || 0) > 200) {
        issues.push({
            file: relPath, type: "God Class / God Module", severity: "critical",
            description: `File has ${metrics.functions} functions and ${metrics.codeLines} lines — a God Class pattern.`,
            suggestion: "Split responsibilities into separate classes/modules following SRP.",
        });
    }

    const commentRatio = (metrics.commentLines || 0) / Math.max(metrics.codeLines || 1, 1);
    if ((metrics.codeLines || 0) > 100 && commentRatio < 0.05) {
        issues.push({
            file: relPath, type: "Missing Documentation", severity: "info",
            description: `Only ${Math.round(commentRatio * 100)}% of lines are comments in a ${metrics.codeLines}-line file.`,
            suggestion: "Add JSDoc/docstring comments to functions and classes.",
        });
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const lineNum = i + 1;

        if (/\b(TODO|FIXME|HACK|XXX|BUG|TEMP)\b/.test(trimmed)) {
            issues.push({
                file: relPath, line: lineNum, type: "Technical Debt Marker",
                severity: "info",
                description: `Found debt marker: "${trimmed.substring(0, 80)}"`,
                suggestion: "Address this item or create a tracked issue for it.",
            });
        }

        if (/console\.(log|warn|error|debug)\s*\(/.test(trimmed) && !filePath.includes("test")) {
            issues.push({
                file: relPath, line: lineNum, type: "Debug Statement",
                severity: "info",
                description: `console.log/warn found in production code.`,
                suggestion: "Replace with a proper logger (winston, pino) or remove before production.",
            });
        }

        if (/[^a-zA-Z_$]([\d]{2,})[^a-zA-Z_$\d.]/.test(trimmed) &&
            !trimmed.startsWith("//") && !trimmed.startsWith("*") &&
            !trimmed.includes("version") && !trimmed.includes("port")) {
            if (!issues.some(iss => iss.type === "Magic Numbers" && iss.file === relPath)) {
                issues.push({
                    file: relPath, line: lineNum, type: "Magic Numbers",
                    severity: "info",
                    description: "Unexplained numeric literals found.",
                    suggestion: "Extract magic numbers into named constants at the top of the file.",
                });
            }
        }

        if (/catch\s*\(.*\)\s*\{\s*\}/.test(trimmed) || (trimmed.startsWith("catch") && lines[i + 1]?.trim() === "}")) {
            issues.push({
                file: relPath, line: lineNum, type: "Empty Catch Block",
                severity: "warning",
                description: "Empty catch block swallows errors silently.",
                suggestion: "At minimum, log the error. Better: handle it gracefully or rethrow.",
            });
        }

        if (lang === "TypeScript" && /:\s*any\b/.test(trimmed) && !trimmed.startsWith("//")) {
            if (!issues.some(iss => iss.type === "TypeScript any Usage" && iss.file === relPath)) {
                issues.push({
                    file: relPath, line: lineNum, type: "TypeScript any Usage",
                    severity: "info",
                    description: "Usage of `any` type defeats TypeScript's type safety.",
                    suggestion: "Replace `any` with proper types, generics, or `unknown`.",
                });
            }
        }

        if (line.length > 120 && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
            if (!issues.some(iss => iss.type === "Long Lines" && iss.file === relPath)) {
                issues.push({
                    file: relPath, line: lineNum, type: "Long Lines",
                    severity: "info",
                    description: `Line exceeds 120 characters (${line.length} chars).`,
                    suggestion: "Break long lines for readability. Configure max-line-length in your linter.",
                });
            }
        }

        if ((line.match(/function\s*\(|=>\s*\{/g) || []).length >= 2) {
            if (!issues.some(iss => iss.type === "Callback Hell" && iss.file === relPath)) {
                issues.push({
                    file: relPath, line: lineNum, type: "Callback Hell",
                    severity: "warning",
                    description: "Multiple nested callbacks detected.",
                    suggestion: "Refactor to async/await or Promise chains for readability.",
                });
            }
        }
    }

    return issues;
}

function scoreFile(metrics: Partial<FileMetrics>, issueCount: number, criticals: number): number {
    let score = 100;

    const cc = metrics.cyclomaticComplexity || 0;
    if (cc > 20) score -= 25;
    else if (cc > 10) score -= 10;
    else if (cc > 5) score -= 5;

    const loc = metrics.codeLines || 0;
    if (loc > 500) score -= 20;
    else if (loc > 300) score -= 10;
    else if (loc > 200) score -= 5;

    const nest = metrics.maxNestingDepth || 0;
    if (nest > 6) score -= 15;
    else if (nest > 4) score -= 8;

    score -= criticals * 10;
    score -= (issueCount - criticals) * 3;

    score -= (metrics.duplicateBlocks || 0) * 5;

    return Math.max(0, Math.min(100, score));
}

function scoreToGrade(score: number): string {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 55) return "D";
    return "F";
}

export function analyzeFile(filePath: string, relPath: string): FileMetrics | null {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const lang = detectFileLang(filePath);

        if (lang === "Unknown") return null;

        const blankLines = lines.filter(l => l.trim() === "").length;
        const commentLines = lines.filter(l => /^\s*(\/\/|\/\*|\*|#|\"\"\"|\'\'\')/.test(l)).length;
        const codeLines = lines.length - blankLines - commentLines;

        const cyclomaticComplexity = calcCyclomatic(content);
        const cognitiveComplexity = calcCognitive(lines);
        const maxNestingDepth = calcMaxNesting(lines);
        const maxFunctionLength = calcMaxFunctionLength(lines);
        const functions = countFunctions(content, lang);
        const classes = countClasses(content);
        const duplicateBlocks = countDuplicateBlocks(lines);

        const partial: Partial<FileMetrics> = {
            codeLines, cyclomaticComplexity, cognitiveComplexity,
            maxNestingDepth, maxFunctionLength, functions, classes,
            duplicateBlocks, commentLines,
        };

        const issues = detectIssues(lines, content, relPath, lang, partial);
        const criticals = issues.filter(i => i.severity === "critical").length;
        const score = scoreFile(partial, issues.length, criticals);

        return {
            path: relPath,
            language: lang,
            lines: lines.length,
            blankLines,
            commentLines,
            codeLines,
            functions,
            classes,
            maxFunctionLength,
            maxNestingDepth,
            cyclomaticComplexity,
            cognitiveComplexity,
            duplicateBlocks,
            issues,
            score,
            grade: scoreToGrade(score),
        };
    } catch (_) {
        return null;
    }
}