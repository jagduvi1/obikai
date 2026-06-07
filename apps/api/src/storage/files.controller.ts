import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Controller, Get, Inject, Put, Query, Req, Res } from '@nestjs/common';
import { resolveObjectPath } from '@obikai/adapter-storage-fs';
import type { Request, Response } from 'express';
import {
  type FilesQuery,
  authorizeFsRequest,
  contentTypeForKey,
  decodeKey,
} from './files.support.js';
import { FILES_CONFIG, type FilesConfig } from './storage.tokens.js';

/** Upload ceiling for the fs route (no per-token size in the HMAC, so the route caps defensively). */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

class PayloadTooLargeError extends Error {}

/** Stream a request body to disk, aborting if it exceeds the cap (defends the single box). */
async function streamToFileWithCap(req: Request, path: string, maxBytes: number): Promise<void> {
  let total = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(new PayloadTooLargeError());
        return;
      }
      cb(null, chunk);
    },
  });
  await pipeline(req, cap, createWriteStream(path));
}

/**
 * The guarded `/files` route backing the fs storage adapter (ADR-0003/0019). The adapter mints
 * short-lived HMAC-signed URLs pointing here; this route verifies the token (op + key + expiry),
 * resolves the key to a path strictly inside the storage root (traversal-safe via the adapter's
 * `resolveObjectPath`), and streams bytes to/from disk — the app never streams object bytes through
 * the adapter itself (invariant 10). Only mounted when STORAGE_PROVIDER=fs; s3 presigns to S3
 * directly and never reaches the app.
 *
 * NOTE: uploads MUST use a binary Content-Type (e.g. application/pdf) — Nest's JSON/urlencoded body
 * parsers only consume their own content-types, leaving the request a raw stream for us to pipe.
 */
@Controller('files')
export class FilesController {
  constructor(@Inject(FILES_CONFIG) private readonly cfg: FilesConfig) {}

  @Put('*')
  async put(@Req() req: Request, @Res() res: Response, @Query() query: FilesQuery): Promise<void> {
    const key = decodeKey(req.path);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!authorizeFsRequest('put', key, query, this.cfg.signingSecret, nowSec)) {
      res.status(403).json({ message: 'invalid or expired upload token' });
      return;
    }
    let path: string;
    try {
      path = resolveObjectPath(this.cfg.root, key);
    } catch {
      res.status(400).json({ message: 'invalid storage key' });
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    try {
      await streamToFileWithCap(req, path, MAX_UPLOAD_BYTES);
    } catch (err) {
      await rm(path, { force: true });
      if (err instanceof PayloadTooLargeError) {
        res.status(413).json({ message: 'file exceeds the maximum size' });
        return;
      }
      throw err;
    }
    res.status(204).end();
  }

  @Get('*')
  async get(@Req() req: Request, @Res() res: Response, @Query() query: FilesQuery): Promise<void> {
    const key = decodeKey(req.path);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!authorizeFsRequest('get', key, query, this.cfg.signingSecret, nowSec)) {
      res.status(403).json({ message: 'invalid or expired download token' });
      return;
    }
    let path: string;
    try {
      path = resolveObjectPath(this.cfg.root, key);
    } catch {
      res.status(400).json({ message: 'invalid storage key' });
      return;
    }
    try {
      await stat(path);
    } catch {
      res.status(404).json({ message: 'not found' });
      return;
    }
    res.setHeader('Content-Type', contentTypeForKey(key));
    await pipeline(createReadStream(path), res);
  }
}
