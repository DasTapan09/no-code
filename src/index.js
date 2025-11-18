import * as core from '@actions/core';
import fetch from 'node-fetch';

function chooseBaseUrl(env) {
  const e = (env || 'Prod').toLowerCase();
  if (e === 'qa') return 'https://sedstart.sedinqa.com';
  if (e === 'prod') return 'https://app.sedstart.com';
  throw new Error(`Invalid environment: ${env}. Use QA or Prod.`);
}

async function run() {
  try {
    const apiKey = core.getInput('apiKey', { required: true });
    const projectId = core.getInput('projectId', { required: true });
    const testId = core.getInput('testId', { required: true });
    const profileId = core.getInput('profileId', { required: true });
    const browser = core.getInput('browser') || 'chrome';
    const headless = (core.getInput('headless') || 'true').toLowerCase() === 'true';
    const environment = core.getInput('environment') || 'Prod';

    const baseUrl = chooseBaseUrl(environment);
    const url = `${baseUrl}/api/project/${projectId}/runCI`;
    const payload = { test_id: Number(testId), profile_id: Number(profileId), browser, headless };

    console.log(`Triggering run on ${baseUrl} for project ${projectId} (test ${testId})`);
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `APIKey ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Failed to start run — HTTP ${resp.status}: ${body}`);
    }

    console.log('Streaming events (SSE) — will print server events until run finishes.');
    const reader = resp.body.getReader();
    let decoder = new TextDecoder('utf-8');
    let buf = '';

    let finalStatus = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // process lines
      const parts = buf.split(/\r?\n/);
      buf = parts.pop(); // remainder

      for (const line of parts) {
        if (!line) continue;
        // SSE lines like: data:{"..."}
        if (line.startsWith('data:')) {
          const jsonText = line.slice(5).trim();
          try {
            const obj = JSON.parse(jsonText);
            // Print pretty JSON for visibility
            console.log(JSON.stringify(obj, null, 2));
            // detect status in typical shapes
            if (obj?.result?.status) finalStatus = obj.result.status;
            else if (obj?.result?.run?.status) finalStatus = obj.result.run.status;
            else if (obj?.result?.result?.status) finalStatus = obj.result.result.status;
            else if (obj?.run?.status) finalStatus = obj.run.status;
          } catch (e) {
            console.log('SSE (non-json):', line);
          }
        } else if (line.startsWith('event:')) {
          // optional: print event name
          console.log(line);
        } else {
          console.log(line);
        }
      }
    }

    console.log('SSE stream ended. Final status:', finalStatus);

    if (finalStatus === 'PASS' || finalStatus === 'SUCCESS') {
      core.setOutput('result', finalStatus);
    } else {
      core.setFailed(`Run finished with status: ${finalStatus || 'UNKNOWN'}`);
    }
  } catch (err) {
    core.setFailed(err.message || String(err));
  }
}

run();

