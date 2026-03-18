import simpleGit from "simple-git";
import fs from "fs";
import path from "path";
import { QualityReport, ArchitectureInfo, DependencyInfo } from "../types";
import { analyzeFile, detectFileLang } from "./fileAnalyzer";

const ANALYZABLE_EXTS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs",
    ".py", ".java", ".go", ".rs", ".rb", ".php", ".cs", ".cpp", ".cc", ".c",
]);

function walkDir(dir: string, depth = 0, maxDepth = 5): string[] {
    if (depth > maxDepth) return [];
    const files: string[] = [];
    const SKIP = ["node_modules", ".git", "dist", "build", "__pycache__", ".next", "coverage", "vendor", ".cache"];
    try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            if (SKIP.includes(entry)) continue;
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) files.push(...walkDir(full, depth + 1, maxDepth));
            else files.push(full);
        }
    } catch (_) { }
    return files;
}

function detectArchitecture(relFiles: string[], deps: Record<string, string>, devDeps: Record<string, string>): ArchitectureInfo {
    const all = { ...deps, ...devDeps };
    const hasTests = relFiles.some(f => f.includes("test") || f.includes("spec") || f.includes("__tests__"));
    const hasLinting = !!(all["eslint"] || all["pylint"]);
    const hasTypes = !!(all["typescript"] || relFiles.some(f => f.endsWith(".ts")));
    const hasDocker = relFiles.some(f => f.includes("Dockerfile"));
    const hasCICD = relFiles.some(f => f.includes(".github/workflows") || f.includes(".gitlab-ci"));

    const layers: string[] = [];
    if (relFiles.some(f => f.includes("controllers/"))) layers.push("Controllers");
    if (relFiles.some(f => f.includes("services/"))) layers.push("Services");
    if (relFiles.some(f => f.includes("models/"))) layers.push("Models");
    if (relFiles.some(f => f.includes("routes/"))) layers.push("Routes");
    if (relFiles.some(f => f.includes("repositories/"))) layers.push("Repositories");
    if (relFiles.some(f => f.includes("middleware"))) layers.push("Middleware");
    if (relFiles.some(f => f.includes("domain/"))) layers.push("Domain");
    if (relFiles.some(f => f.includes("infrastructure/"))) layers.push("Infrastructure");
    if (relFiles.some(f => f.includes("utils/"))) layers.push("Utilities");

    let archType = "Simple";
    if (layers.includes("Domain") && layers.includes("Infrastructure")) archType = "Clean Architecture";
    else if (layers.includes("Controllers") && layers.includes("Models")) archType = "MVC";
    else if (layers.includes("Services") && layers.includes("Repositories")) archType = "Layered";

    const entryPoints: string[] = [];
    ["index.ts", "index.js", "main.ts", "main.js", "server.ts", "server.js", "app.ts", "app.js"]
        .forEach(e => { if (relFiles.some(f => f.endsWith(e))) entryPoints.push(e); });

    return {
        type: archType, layers,
        hasTests, testCoverage: 0,
        hasLinting, hasTypeChecking: hasTypes,
        hasDocker, hasCICD, entryPoints,
        circularDeps: [],
    };
}

function analyzeDeps(deps: Record<string, string>, devDeps: Record<string, string>): DependencyInfo[] {
    const result: DependencyInfo[] = [];
    for (const [name, version] of Object.entries(deps)) {
        result.push({ name, version, type: "prod" });
    }
    for (const [name, version] of Object.entries(devDeps)) {
        result.push({ name, version, type: "dev" });
    }
    return result;
}

function detectPrimaryLang(files: string[]): string {
    const counts: Record<string, number> = {};
    for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        counts[ext] = (counts[ext] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const langMap: Record<string, string> = {
        ".ts": "TypeScript", ".tsx": "TypeScript",
        ".js": "JavaScript", ".jsx": "JavaScript",
        ".py": "Python", ".java": "Java", ".go": "Go",
        ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
    };
    for (const [ext] of sorted) {
        if (langMap[ext]) return langMap[ext];
    }
    return "Mixed";
}

async function getAISuggestions(report: Partial<QualityReport>): Promise<string[]> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return [];

    try {
        const axios = require("axios");
        const topIssues = (report.topIssues || []).slice(0, 5).map(i => `- ${i.type}: ${i.description}`).join("\n");
        const prompt = `You are a senior software engineer doing a code review.
Repository: ${report.repoName}
Language: ${report.language}
Overall Score: ${report.overallScore}/100 (Grade: ${report.overallGrade})
Total Issues: ${report.totalIssues} (${report.criticalIssues} critical)
Top Issues:
${topIssues}

Provide 5 specific, actionable improvement suggestions as a numbered list. Be direct and technical.`;

        const res = await axios.default.post(
            "https://api.openai.com/v1/chat/completions",
            { model: "gpt-3.5-turbo", messages: [{ role: "user", content: prompt }], max_tokens: 400, temperature: 0.7 },
            { headers: { Authorization: `Bearer ${key}` } }
        );
        const text: string = res.data.choices[0].message.content.trim();
        return text.split("\n").filter((l: string) => l.trim()).slice(0, 8);
    } catch (_) { return []; }
}

function gradeFromScore(score: number): string {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 55) return "D";
    return "F";
}

export async function analyzeRepo(
    repoUrl: string,
    cloneBase: string,
    log: (msg: string) => void
): Promise<QualityReport> {
    const repoName = repoUrl.replace(/\.git$/, "").split("/").pop() || "repo";
    const clonePath = path.join(cloneBase, repoName);

    if (fs.existsSync(clonePath)) {
        log(`REMOVING OLD CLONE...`);
        fs.rmSync(clonePath, { recursive: true, force: true });
    }

    log(`CLONING: ${repoUrl}`);
    await simpleGit().clone(repoUrl, clonePath, ["--depth", "1"]);
    log(`CLONE COMPLETE`);

    const allFiles = walkDir(clonePath);
    const relFiles = allFiles.map(f => path.relative(clonePath, f).replace(/\\/g, "/"));
    const codeFiles = allFiles.filter(f => ANALYZABLE_EXTS.has(path.extname(f).toLowerCase()));
    log(`TOTAL FILES: ${allFiles.length} | CODE FILES: ${codeFiles.length}`);

    let pkgJson: any = {};
    const pkgPath = path.join(clonePath, "package.json");
    if (fs.existsSync(pkgPath)) {
        try { pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8")); } catch (_) { }
    }
    const deps = pkgJson.dependencies || {};
    const devDeps = pkgJson.devDependencies || {};

    const language = detectPrimaryLang(relFiles);
    const architecture = detectArchitecture(relFiles, deps, devDeps);
    const dependencies = analyzeDeps(deps, devDeps);

    log(`ANALYZING CODE FILES...`);
    const fileMetrics = [];
    let analyzed = 0;
    for (const absPath of codeFiles) {
        const relPath = path.relative(clonePath, absPath).replace(/\\/g, "/");
        const metrics = analyzeFile(absPath, relPath);
        if (metrics) {
            fileMetrics.push(metrics);
            analyzed++;
            if (analyzed % 10 === 0) log(`ANALYZED: ${analyzed}/${codeFiles.length} files`);
        }
    }
    log(`ANALYSIS COMPLETE: ${analyzed} files processed`);

    const allIssues = fileMetrics.flatMap(f => f.issues);
    const criticalIssues = allIssues.filter(i => i.severity === "critical").length;
    const warningIssues = allIssues.filter(i => i.severity === "warning").length;

    const totalLines = fileMetrics.reduce((s, f) => s + f.lines, 0);
    const totalFuncs = fileMetrics.reduce((s, f) => s + f.functions, 0);
    const totalClasses = fileMetrics.reduce((s, f) => s + f.classes, 0);

    const avgScore = fileMetrics.length > 0
        ? Math.round(fileMetrics.reduce((s, f) => s + f.score, 0) / fileMetrics.length)
        : 100;

    const avgCC = fileMetrics.length > 0
        ? fileMetrics.reduce((s, f) => s + f.cyclomaticComplexity, 0) / fileMetrics.length
        : 0;

    const duplicationPenalty = Math.min(30, fileMetrics.reduce((s, f) => s + f.duplicateBlocks, 0) * 2);

    const maintainabilityScore = Math.max(0, avgScore);
    const complexityScore = Math.max(0, 100 - Math.min(100, (avgCC - 1) * 5));
    const duplicationScore = Math.max(0, 100 - duplicationPenalty);
    const styleScore = architecture.hasLinting ? 85 : 60;

    const overallScore = Math.round(
        maintainabilityScore * 0.35 +
        complexityScore * 0.30 +
        duplicationScore * 0.20 +
        styleScore * 0.15
    );

    const issueCounts: Record<string, number> = {};
    for (const iss of allIssues) issueCounts[iss.type] = (issueCounts[iss.type] || 0) + 1;
    const topIssues = allIssues
        .filter((iss, idx, arr) => arr.findIndex(x => x.type === iss.type) === idx)
        .sort((a, b) => {
            const sev: Record<string, number> = { critical: 3, warning: 2, info: 1, good: 0 };
            return (sev[b.severity] - sev[a.severity]) || (issueCounts[b.type] - issueCounts[a.type]);
        })
        .slice(0, 15);

    const partial: Partial<QualityReport> = {
        repoName, repoUrl, language,
        overallScore, overallGrade: gradeFromScore(overallScore),
        maintainabilityScore, complexityScore, duplicationScore, styleScore,
        totalFiles: analyzed, totalLines, totalFunctions: totalFuncs, totalClasses,
        totalIssues: allIssues.length, criticalIssues, warningIssues,
        topIssues,
    };

    log(`SCORE: ${overallScore}/100 (${gradeFromScore(overallScore)}) | ISSUES: ${allIssues.length} | CRITICAL: ${criticalIssues}`);
    log(`FETCHING AI SUGGESTIONS...`);
    const aiSuggestions = await getAISuggestions(partial);
    if (aiSuggestions.length > 0) log(`AI SUGGESTIONS: ${aiSuggestions.length} generated`);

    try { fs.rmSync(clonePath, { recursive: true, force: true }); } catch (_) { }
    log(`CLEANUP COMPLETE`);

    return {
        ...partial as QualityReport,
        files: fileMetrics.sort((a, b) => a.score - b.score),
        architecture,
        dependencies,
        totalDeps: Object.keys(deps).length,
        devDeps: Object.keys(devDeps).length,
        aiSuggestions,
        analyzedAt: new Date().toISOString(),
        reportMarkdown: "",
    };
}