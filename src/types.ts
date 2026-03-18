export type Severity = "critical" | "warning" | "info" | "good";

export interface Issue {
    file: string;
    line?: number;
    type: string;
    severity: Severity;
    description: string;
    suggestion: string;
}

export interface FileMetrics {
    path: string;
    language: string;
    lines: number;
    blankLines: number;
    commentLines: number;
    codeLines: number;
    functions: number;
    classes: number;
    maxFunctionLength: number;
    maxNestingDepth: number;
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    duplicateBlocks: number;
    issues: Issue[];
    grade: string;
    score: number;
}

export interface DependencyInfo {
    name: string;
    version: string;
    type: "prod" | "dev";
    isOutdated?: boolean;
}

export interface ArchitectureInfo {
    type: string;
    layers: string[];
    hasTests: boolean;
    testCoverage: number;
    hasLinting: boolean;
    hasTypeChecking: boolean;
    hasDocker: boolean;
    hasCICD: boolean;
    entryPoints: string[];
    circularDeps: string[];
}

export interface QualityReport {
    repoName: string;
    repoUrl: string;
    language: string;
    analyzedAt: string;
    overallScore: number;
    overallGrade: string;
    maintainabilityScore: number;
    complexityScore: number;
    duplicationScore: number;
    styleScore: number;
    totalFiles: number;
    totalLines: number;
    totalFunctions: number;
    totalClasses: number;
    totalIssues: number;
    criticalIssues: number;
    warningIssues: number;
    files: FileMetrics[];
    topIssues: Issue[];
    architecture: ArchitectureInfo;
    dependencies: DependencyInfo[];
    totalDeps: number;
    devDeps: number;
    aiSuggestions: string[];
    reportMarkdown: string;
}