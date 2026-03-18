import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { analyzeRepo } from "./analyzers/repoAnalyzer";
import { generateMarkdownReport } from "./reporters/markdownReporter";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const CLONE_DIR = path.join(__dirname, "../.tmp/clones");
if (!fs.existsSync(CLONE_DIR)) fs.mkdirSync(CLONE_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.post("/analyze", async (req, res) => {
    const { repoUrl } = req.body;
    if (!repoUrl || !repoUrl.startsWith("http")) {
        res.status(400).json({ error: "Invalid or missing repository URL" });
        return;
    }

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });

    const log = (msg: string) => {
        res.write(msg + "\n");
        console.log(`[CODESYS] ${msg}`);
    };

    try {
        log(`TARGET: ${repoUrl}`);
        log("INITIALIZING STATIC ANALYZER...");

        const report = await analyzeRepo(repoUrl, CLONE_DIR, log);

        log("GENERATING MARKDOWN REPORT...");
        report.reportMarkdown = generateMarkdownReport(report);

        log("TRANSMITTING REPORT TO DASHBOARD...");
        io.emit("report-ready", report);

        log("──────────────────────────────────────");
        log(`✅ ANALYSIS COMPLETE — GRADE: ${report.overallGrade} (${report.overallScore}/100)`);
        res.end("DONE");

    } catch (err: any) {
        log(`❌ FATAL: ${err.message}`);
        res.end("ERROR");
    }
});

app.post("/download", (req, res) => {
    const { content, filename, type } = req.body;
    if (!content) { res.status(400).send("No content"); return; }
    const mime = type === "html" ? "text/html" : "text/markdown";
    res.setHeader("Content-Disposition", `attachment; filename="${filename || "report.md"}"`);
    res.setHeader("Content-Type", mime);
    res.send(content);
});

io.on("connection", () => console.log("[CODESYS] Dashboard connected"));

server.listen(PORT, () => console.log(`[CODESYS] Server → http://localhost:${PORT}`));