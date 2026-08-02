from pathlib import Path

p = Path(r"c:\Users\USUARIO\Desktop\cmr\-cmr-mapleads-main\src\routes\api\public\engine\ingest.ts")
text = p.read_text(encoding="utf-8")
start = text.index("async function hasExistingAiReplyCommand(")
mid = text.index("async function hasDuplicateIncomingMessage(")
text = text[:start] + text[mid:]
start2 = text.index("async function maybeAiReply(")
end2 = text.index("export const Route = createFileRoute('/api/public/engine/ingest')")
text = text[:start2] + text[end2:]
p.write_text(text, encoding="utf-8")
print("ok", len(text))
