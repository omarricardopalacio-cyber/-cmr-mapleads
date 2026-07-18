const fs = require("fs");
const path = require("path");

function patchFile(relPath, extra) {
  const filePath = path.join(__dirname, "..", relPath);
  let s = fs.readFileSync(filePath, "utf8");
  if (extra) s = extra(s);
  fs.writeFileSync(filePath, s, "utf8");
  console.log("patched", relPath);
}

patchFile("src/lib/automations.functions.ts", (s) => {
  s = s.replace(
    'import { assertSuperAdmin, globalDb } from "./super-admin.server";',
    'import { ensureUserOrg } from "./org-helpers";',
  );
  s = s.replace(/await assertSuperAdmin\(context\.userId\);\n\s*/g, "");
  s = s.replace(/globalDb\(\)/g, "supabaseAdmin");
  s = s.replace(/\.from\("auto_replies_v"\)/g, '.from("auto_replies")');
  s = s.replace(/\.from\("quick_replies_v"\)/g, '.from("quick_replies")');
  s = s.replace(/\.from\("flows_v"\)/g, '.from("flows")');
  s = s.replace(/\.from\("flow_steps_v"\)/g, '.from("flow_steps")');
  s = s.replace(/\.from\("knowledge_sources_v"\)/g, '.from("knowledge_sources")');
  s = s.replace(/\.from\("transfer_rules_v"\)/g, '.from("transfer_rules")');
  s = s.replace(/org_id: null/g, "org_id: orgId");
  return s;
});

patchFile("src/lib/flows.functions.ts", (s) => {
  s = s.replace(
    'import { assertSuperAdmin, globalDb } from "@/lib/super-admin.server";',
    'import { ensureUserOrg } from "@/lib/org-helpers";',
  );
  s = s.replace(/await assertSuperAdmin\(context\.userId\);\n\s*/g, "");
  s = s.replace(/globalDb\(\)/g, "supabaseAdmin");
  s = s.replace(/\.from\("flows_v"\)/g, '.from("flows")');
  s = s.replace(/\.from\("flow_steps_v"\)/g, '.from("flow_steps")');
  s = s.replace(/org_id: null/g, "org_id: orgId");
  return s;
});

patchFile("src/lib/tags.functions.ts", (s) => {
  s = s.replace(
    'import { assertSuperAdmin, globalDb } from "./super-admin.server";',
    'import { ensureUserOrg } from "./org-helpers";',
  );
  s = s.replace(/await assertSuperAdmin\(context\.userId\);\n\s*/g, "");
  s = s.replace(/globalDb\(\)/g, "supabaseAdmin");
  s = s.replace(/\.from\("tags_v"\)/g, '.from("tags")');
  s = s.replace(/org_id: null/g, "org_id: orgId");
  return s;
});

patchFile("src/lib/crm.functions.ts", (s) => {
  s = s.replace(
    'import { assertSuperAdmin, globalDb } from "./super-admin.server";',
    'import { ensureUserOrg } from "./org-helpers";',
  );
  s = s.replace(/await assertSuperAdmin\(context\.userId\);\n\s*/g, "");
  s = s.replace(/globalDb\(\)/g, "supabaseAdmin");
  s = s.replace(/\.from\("pipeline_stages_v"\)/g, '.from("pipeline_stages")');
  s = s.replace(/org_id: null/g, "org_id: orgId");
  return s;
});
