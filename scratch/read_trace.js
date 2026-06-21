import fs from 'fs';

const logPath = "C:\\Users\\USUARIO\\.gemini\\antigravity\\brain\\36645d7e-d900-4684-b2e2-46d02e0430f5\\.system_generated\\tasks\\task-45.log";
const traceId = "h04rv797xmqlk2kxg";

function main() {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  
  let inTrace = false;
  let bracesCount = 0;
  
  console.log("=== EXTRACTED TRACE LOGS ===");
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if line contains trace ID or is PROMPT_TO_MODEL
    if (line.includes(`[TRACE:${traceId}]`) || line.includes('[TRACE:PROMPT_TO_MODEL]')) {
      console.log(line);
      continue;
    }
    
    // Also grab lines immediately following trace lines if they look like part of a JSON print
    // Simple heuristic: if the trace line ended with '{' or '[', we grab lines until braces/brackets balance
    // Let's just print the 300 lines starting from the first match of our trace ID to be safe and simple!
  }
}

// Let's do a simpler approach: print all lines from the first occurrence of our trace ID to the end of the file.
function simpleMain() {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  let startIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`[TRACE:${traceId}]`)) {
      startIndex = i;
      break;
    }
  }
  
  if (startIndex === -1) {
    console.log("Trace ID not found");
    return;
  }
  
  console.log(lines.slice(startIndex, startIndex + 300).join('\n'));
}

simpleMain();
