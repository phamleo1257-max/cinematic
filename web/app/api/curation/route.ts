import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

type CurationStatus = "curated" | "raw" | "rejected";
type MetadataFrame = {
  filename?: string;
  curationStatus?: string;
  mainFeed?: boolean;
  metadataVerified?: boolean;
  verifiedMetadata?: boolean;
  collections?: unknown;
  [key: string]: unknown;
};

const validStatuses = new Set<CurationStatus>(["curated", "raw", "rejected"]);
const bestframesDir = path.join(process.cwd(), "public", "bestframes");
const metadataPath = path.join(bestframesDir, "metadata.json");

function readMetadata() {
  const root = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as unknown;
  const frames = Array.isArray((root as { frames?: unknown[] })?.frames)
    ? ((root as { frames: MetadataFrame[] }).frames)
    : Array.isArray(root)
      ? (root as MetadataFrame[])
      : [];

  return { root, frames };
}

function backupMetadata() {
  const backupDir = path.join(bestframesDir, ".metadata-backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `metadata.json.${timestamp}.bak`);

  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(metadataPath, backupPath);
  return backupPath;
}

function nextCollections(frame: MetadataFrame, status: CurationStatus) {
  const existing = Array.isArray(frame.collections) ? frame.collections : [];

  return Array.from(
    new Set(
      [
        ...existing.filter((collection) => !/^curated$|^raw$|^rejected$|^main feed$/i.test(String(collection))),
        status,
        status === "curated" ? "main feed" : null,
        status === "rejected" ? "rejected" : null,
        frame.metadataVerified || frame.verifiedMetadata ? null : "unverified",
      ]
        .filter(Boolean)
        .map((collection) => String(collection).toLowerCase()),
    ),
  );
}

function writeMetadata(root: unknown, frames: MetadataFrame[]) {
  const nextRoot = Array.isArray(root)
    ? frames
    : {
        ...(root && typeof root === "object" ? root : {}),
        generatedAt: new Date().toISOString(),
        frames,
      };

  fs.writeFileSync(metadataPath, `${JSON.stringify(nextRoot, null, 2)}\n`);
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    filename?: string;
    status?: CurationStatus;
    dryRun?: boolean;
  };
  const filename = String(body.filename || "");
  const status = body.status;

  if (!filename || !status || !validStatuses.has(status)) {
    return NextResponse.json({ error: "filename and valid status are required" }, { status: 400 });
  }

  const { root, frames } = readMetadata();
  const index = frames.findIndex((frame) => frame.filename === filename);

  if (index === -1) {
    return NextResponse.json({ error: "frame not found" }, { status: 404 });
  }

  const previous = frames[index].curationStatus || "raw";
  const nextFrame = {
    ...frames[index],
    curationStatus: status,
    mainFeed: status === "curated" && Boolean(frames[index].metadataVerified || frames[index].verifiedMetadata),
    collections: nextCollections(frames[index], status),
    curationUpdatedAt: new Date().toISOString(),
  };

  if (body.dryRun) {
    return NextResponse.json({
      dryRun: true,
      filename,
      previous,
      next: status,
      frame: nextFrame,
    });
  }

  const backupPath = backupMetadata();
  const nextFrames = [...frames];
  nextFrames[index] = nextFrame;
  writeMetadata(root, nextFrames);

  return NextResponse.json({
    ok: true,
    filename,
    previous,
    next: status,
    backup: path.relative(process.cwd(), backupPath),
  });
}
