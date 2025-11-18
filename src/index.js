import * as core from '@actions/core';
import fetch from "node-fetch";

async function run() {
  try {
    const apiKey     = core.getInput("api_key", { required: true });
    const projectId  = core.getInput("project_id", { required: true });
    const testId     = core.getInput("test_id", { required: true });
    const profileId  = core.getInput("profile_id", { required: true });
    const browser    = core.getInput("browser", { required: true });
    const headless   = core.getInput("headless") === "true";
    const environment = core.getInput("environment") || "Prod";

    // ✅ Determine Base URL
    const baseUrl =
      environment.toLowerCase() === "qa"
        ? "https://sedstart.sedinqa.com"
        : "https://app.sedstart.com";

    const url = `${baseUrl}/api/project/${projectId}/runCI`;

    console.log(`🚀 Triggering SedStart CI Run: ${url}`);

    const payload = {
      project_id: Number(projectId),
      test_id: Number(testId),
      profile_id: Number(profileId),
      browser,
      headless
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    console.log("📡 Streaming events...");

    // ✅ Node.js Readable Stream (NOT getReader())
    const stream = response.body;

    let buffer = "";
    let finalStatus = "UNKNOWN";

    stream.on("data", (chunk) => {
      const text = chunk.toString();
      buffer += text;

      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop(); // incomplete line stays in buffer

      for (const line of parts) {
        if (!line.trim()) continue;

        if (line.startsWith("data:")) {
          const jsonText = line.slice(5).trim();

          try {
            const obj = JSON.parse(jsonText);
            console.log(JSON.stringify(obj, null, 2));

            if (obj?.result?.status) {
              finalStatus = obj.result.status;
            }
            if (obj?.run?.status) {
              finalStatus = obj.run.status;
            }
          } catch (err) {
            console.log("⚠️ Invalid SSE JSON:", jsonText);
          }
        } else {
          console.log(line);
        }
      }
    });

    stream.on("end", () => {
      console.log("✅ SSE Stream ended.");

      if (finalStatus === "PASS" || finalStatus === "SUCCESS") {
        console.log(`✅ Test Finished: ${finalStatus}`);
        core.setOutput("result", finalStatus);
      } else {
        core.setFailed(`❌ Test Finished with status: ${finalStatus}`);
      }
    });

    stream.on("error", (err) => {
      core.setFailed(`❌ Stream error: ${err.message}`);
    });

  } catch (error) {
    core.setFailed(`❌ Action failed: ${error.message}`);
  }
}

run();

