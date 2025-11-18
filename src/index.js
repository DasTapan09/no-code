import * as core from '@actions/core';
import fetch from "node-fetch";
function formatReadableEvent(obj) {
  const status = obj.status || obj.result?.status || "";
  const prefix =
    status === "PASS" || status === "success" ? "✅" :
    status === "FAIL" || status === "failure" ? "❌" :
    status === "ERROR" ? "🔥" :
    "📢";

  let msg = `${prefix} ${obj.message || status}`;

  // If inside "result"
  if (obj.result) {
    const r = obj.result;

    if (r.name) msg += ` → ${r.name}`;
    if (r.time) msg += ` (Time: ${r.time})`;
    if (r.error) msg += `\n   ⚠️ Error: ${r.error}`;
    if (r.video?.length) msg += `\n   🎥 Video: ${r.video[0]}`;
  }

  // If inside "data"
  if (obj.data) {
    const d = obj.data;
    if (typeof d === "string") {
      msg += ` → ${d}`;
    } else if (typeof d === "object") {
      if (d.step) msg += ` → Step: ${d.step}`;
      if (d.status) msg += ` → Status: ${d.status}`;
      if (d.error) msg += `\n   ⚠️ Error: ${d.error}`;
    }
  }

  return msg;
}

async function run() {
  try {
    const apiKey = core.getInput("api_key", { required: true });
    const projectId = core.getInput("project_id", { required: true });
    const testId = core.getInput("test_id");
    const suiteId = core.getInput("suite_id");
    const profileId = core.getInput("profile_id", { required: true });
    const browser = core.getInput("browser", { required: true });
    const headless = core.getInput("headless") === "true";
    const environment = core.getInput("environment") || "Prod";
    if (!testId && !suiteId) {
      core.setFailed("You must provide either test_id or suite_id.");
      return;
    }
    let idPayload = {};

    if (suiteId) {
      idPayload.suite_id = Number(suiteId);
    } else {
      idPayload.test_id = Number(testId);
    }

    // ✅ Determine Base URL
    const baseUrl =
      environment.toLowerCase() === "qa"
        ? "https://sedstart.sedinqa.com"
        : "https://app.sedstart.com";

    const url = `${baseUrl}/api/project/${projectId}/runCI`;

    console.log(`🚀 Triggering SedStart CI Run: ${url}`);

    const payload = {
      project_id: Number(projectId),
      ...idPayload,
      profile_id: Number(profileId),
      browser,
      headless
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "APIKey " + apiKey,
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
      buffer = parts.pop();

      for (const line of parts) {
        if (!line.trim()) continue;

        if (!line.startsWith("data:")) continue;

        const jsonText = line.slice(5).trim();
        let obj;

        try {
          obj = JSON.parse(jsonText);
        } catch {
          console.log(`⚠️ Could not parse event: ${jsonText}`);
          continue;
        }

        // ✅ HUMAN-FRIENDLY LOGGING
        console.log(formatReadableEvent(obj));

        // ✅ Extract ONLY the test result status
        if (obj?.result?.status) {
          finalStatus = obj.result.status;
          console.log(`✅ Result Status Updated → ${finalStatus}`);
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
