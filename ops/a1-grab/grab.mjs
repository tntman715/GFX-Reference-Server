#!/usr/bin/env node
// Keeps asking Oracle Cloud for an Always Free A1 (ARM) instance until one is created,
// then posts the result to the Discord report channel. No dependencies: Node 18+ only.
//
//   node grab.mjs         one attempt (run by the systemd timer every ~2 minutes)
//   node grab.mjs check   only checks the key and prints what would be requested
//
// Settings come from a1.env next to this file (see README.md). The Discord bot token and
// report channel are read from the GFX server's .env so they are not copied anywhere.

import { createHash, createSign, createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHAPE = 'VM.Standard.A1.Flex';
const API = '20160918';

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const env = { ...parseEnvFile(join(HERE, 'a1.env')), ...process.env };
const gfxEnv = parseEnvFile(env.GFX_ENV_FILE || '/opt/gfx/server/.env');
const home = homedir();
const cfg = {
  user: env.OCI_USER,
  tenancy: env.OCI_TENANCY,
  fingerprint: env.OCI_FINGERPRINT,
  region: env.OCI_REGION,
  keyFile: (env.OCI_KEY_FILE || '~/.oci/oci_api_key.pem').replace(/^~/, home),
  compartment: env.A1_COMPARTMENT || env.OCI_TENANCY,
  ocpus: Number(env.A1_OCPUS || 2),
  memoryGb: Number(env.A1_MEMORY_GB || 12),
  bootGb: Number(env.A1_BOOT_GB || 50),
  name: env.A1_NAME || 'gfx-a1',
  subnetId: env.A1_SUBNET_ID || '',
  imageId: env.A1_IMAGE_ID || '',
  ad: env.A1_AD || '',
  sshKeyFile: (env.A1_SSH_KEY_FILE || '~/.ssh/authorized_keys').replace(/^~/, home),
  stateFile: (env.A1_STATE_FILE || join(HERE, 'state.json')).replace(/^~/, home),
  discordToken: gfxEnv.DISCORD_TOKEN || env.DISCORD_TOKEN || '',
  channelId: env.A1_NOTIFY_CHANNEL_ID || gfxEnv.REPORT_CHANNEL_ID || ''
};

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadState() {
  try { return JSON.parse(readFileSync(cfg.stateFile, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  writeFileSync(cfg.stateFile, JSON.stringify(s, null, 2));
}

// --- HTTPS helper ---------------------------------------------------------------------

function httpsJson(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      { method, hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 30000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// --- OCI request signing (HTTP Signatures, rsa-sha256) -----------------------------------

let privateKey;
function key() {
  if (!privateKey) privateKey = createPrivateKey(readFileSync(cfg.keyFile));
  return privateKey;
}

class OciError extends Error {
  constructor(status, data) {
    super(`${status} ${data?.code || ''} ${data?.message || ''}`.trim());
    this.status = status;
    this.code = data?.code || '';
  }
}

async function oci(method, service, path, payload) {
  const host = `${service}.${cfg.region}.oraclecloud.com`;
  const url = new URL(`https://${host}/${API}${path}`);
  const headers = { date: new Date().toUTCString(), host };
  const names = ['(request-target)', 'date', 'host'];
  let body;
  if (payload !== undefined) {
    body = JSON.stringify(payload);
    headers['x-content-sha256'] = createHash('sha256').update(body).digest('base64');
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body));
    names.push('x-content-sha256', 'content-type', 'content-length');
  }
  const target = `${method.toLowerCase()} ${url.pathname}${url.search}`;
  const signingString = names
    .map((n) => (n === '(request-target)' ? `${n}: ${target}` : `${n}: ${headers[n]}`))
    .join('\n');
  const signature = createSign('RSA-SHA256').update(signingString).sign(key(), 'base64');
  headers.authorization =
    `Signature version="1",keyId="${cfg.tenancy}/${cfg.user}/${cfg.fingerprint}",` +
    `algorithm="rsa-sha256",headers="${names.join(' ')}",signature="${signature}"`;
  const res = await httpsJson(method, url.toString(), headers, body);
  if (res.status >= 300) throw new OciError(res.status, res.data);
  return res.data;
}

const q = (o) => '?' + new URLSearchParams(o).toString();

// --- Discord --------------------------------------------------------------------------

async function notify(text) {
  if (!cfg.discordToken || !cfg.channelId) {
    log('discord not configured, message was:', text);
    return;
  }
  const body = JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } });
  try {
    const res = await httpsJson(
      'POST',
      `https://discord.com/api/v10/channels/${cfg.channelId}/messages`,
      {
        authorization: `Bot ${cfg.discordToken}`,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body))
      },
      body
    );
    if (res.status >= 300) log('discord failed', res.status, res.data?.message);
  } catch (e) {
    log('discord failed', e.message);
  }
}

// --- Lookups --------------------------------------------------------------------------

function metadata(path) {
  return new Promise((resolve) => {
    // Only reachable from inside an OCI instance.
    import('node:http').then(({ request: httpRequest }) => {
      const req = httpRequest(
        { hostname: '169.254.169.254', path: `/opc/v2/${path}`, headers: { authorization: 'Bearer Oracle' }, timeout: 3000 },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => { try { resolve(JSON.parse(t)); } catch { resolve(null); } });
        }
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
      req.end();
    });
  });
}

async function resolveTargets(state) {
  const t = { ...(state.targets || {}) };
  if (cfg.ad) t.ad = cfg.ad;
  if (cfg.subnetId) t.subnetId = cfg.subnetId;
  if (cfg.imageId) t.imageId = cfg.imageId;

  if (!t.ad || !t.subnetId) {
    const me = await metadata('instance/');
    if (!t.ad) {
      t.ad = me?.availabilityDomain;
      if (!t.ad) {
        const ads = await oci('GET', 'identity', `/availabilityDomains${q({ compartmentId: cfg.tenancy })}`);
        t.ad = ads[0]?.name;
      }
    }
    if (!t.subnetId && me?.id) {
      const atts = await oci('GET', 'iaas', `/vnicAttachments${q({ compartmentId: me.compartmentId, instanceId: me.id })}`);
      t.subnetId = atts.find((a) => a.lifecycleState === 'ATTACHED')?.subnetId;
    }
    if (!t.subnetId) {
      const subnets = await oci('GET', 'iaas', `/subnets${q({ compartmentId: cfg.compartment })}`);
      t.subnetId = subnets.find((s) => s.lifecycleState === 'AVAILABLE' && !s.prohibitPublicIpOnVnic)?.id;
    }
  }
  if (!t.imageId) {
    const images = await oci('GET', 'iaas', `/images${q({
      compartmentId: cfg.compartment,
      operatingSystem: 'Canonical Ubuntu',
      operatingSystemVersion: '24.04',
      shape: SHAPE,
      sortBy: 'TIMECREATED',
      sortOrder: 'DESC',
      limit: '1'
    })}`);
    t.imageId = images[0]?.id;
    t.imageName = images[0]?.displayName;
  }
  if (!t.ad || !t.subnetId || !t.imageId) throw new Error(`could not find targets: ${JSON.stringify(t)}`);
  return t;
}

async function existingA1() {
  const list = await oci('GET', 'iaas', `/instances${q({ compartmentId: cfg.compartment })}`);
  return list.find((i) => i.shape === SHAPE && !['TERMINATED', 'TERMINATING'].includes(i.lifecycleState));
}

async function publicIp(inst) {
  const atts = await oci('GET', 'iaas', `/vnicAttachments${q({ compartmentId: inst.compartmentId, instanceId: inst.id })}`);
  const att = atts.find((a) => a.lifecycleState === 'ATTACHED');
  if (!att) return null;
  const vnic = await oci('GET', 'iaas', `/vnics/${att.vnicId}`);
  return vnic.publicIp || null;
}

function sshKeys() {
  const lines = readFileSync(cfg.sshKeyFile, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(ssh-|ecdsa-)/.test(l));
  if (!lines.length) throw new Error(`no ssh public key in ${cfg.sshKeyFile}`);
  return lines.join('\n');
}

// --- Main -----------------------------------------------------------------------------

async function main() {
  for (const k of ['user', 'tenancy', 'fingerprint', 'region']) {
    if (!cfg[k]) throw new Error(`OCI_${k.toUpperCase()} is missing in a1.env`);
  }
  const state = loadState();
  const mode = process.argv[2] || 'run';

  if (mode === 'check') {
    const targets = await resolveTargets(state);
    state.targets = targets;
    saveState(state);
    const a1 = await existingA1();
    log('key works. targets:', JSON.stringify(targets));
    log(`request: ${SHAPE} ${cfg.ocpus} OCPU / ${cfg.memoryGb} GB, boot ${cfg.bootGb} GB, name ${cfg.name}`);
    log('existing A1:', a1 ? `${a1.displayName} ${a1.lifecycleState}` : 'none');
    log('discord:', cfg.discordToken && cfg.channelId ? `channel ${cfg.channelId}` : 'not configured');
    if (process.argv[3] === 'notify') await notify('🧪 A1 잡기 봇 알림 테스트입니다. (아직 서버를 잡은 것은 아닙니다)');
    return;
  }

  if (state.finished) return; // already done, nothing to do until state.json is removed
  if (state.stopped) {
    log('stopped:', state.stopped, '- fix it and delete state.json to start again');
    return;
  }

  const found = await existingA1();
  if (found) {
    if (found.lifecycleState === 'RUNNING') {
      const ip = await publicIp(found).catch(() => null);
      log('A1 is running', found.id, ip || '');
      await notify(
        `🎉 **오라클 A1 서버가 준비됐어요!**\n이름: ${found.displayName}\n공인 IP: ${ip || '(확인 중)'}\n` +
          `잡기 봇은 이제 멈춥니다. 다음은 데이터 옮기기예요.`
      );
      state.finished = { at: new Date().toISOString(), id: found.id, ip };
    } else {
      log('A1 exists, state', found.lifecycleState);
      if (!state.launched) {
        state.launched = { at: new Date().toISOString(), id: found.id };
        await notify(`🎉 오라클 A1 서버 자리를 잡았어요! 지금 만드는 중이에요 (${found.lifecycleState}). 준비되면 다시 알려 드릴게요.`);
      }
    }
    saveState(state);
    return;
  }

  const targets = await resolveTargets(state);
  state.targets = targets;
  state.attempts = (state.attempts || 0) + 1;
  state.lastAttemptAt = new Date().toISOString();

  try {
    const inst = await oci('POST', 'iaas', '/instances', {
      availabilityDomain: targets.ad,
      compartmentId: cfg.compartment,
      displayName: cfg.name,
      shape: SHAPE,
      shapeConfig: { ocpus: cfg.ocpus, memoryInGBs: cfg.memoryGb },
      sourceDetails: { sourceType: 'image', imageId: targets.imageId, bootVolumeSizeInGBs: cfg.bootGb },
      createVnicDetails: { subnetId: targets.subnetId, assignPublicIp: true },
      metadata: { ssh_authorized_keys: sshKeys() }
    });
    log('LAUNCHED', inst.id, inst.lifecycleState);
    state.launched = { at: new Date().toISOString(), id: inst.id };
    await notify(
      `🎉 **오라클 A1 서버 자리를 잡았어요!** (${state.attempts}번째 시도)\n` +
        `${cfg.ocpus} OCPU / ${cfg.memoryGb} GB · 지금 만드는 중이에요. 준비되면 IP 를 다시 알려 드릴게요.`
    );
  } catch (e) {
    const msg = String(e.message || e);
    if (/capacity/i.test(msg) || e.status === 429 || e.status >= 500) {
      log(`attempt ${state.attempts}: no luck (${msg})`);
    } else {
      // Anything else (limits, wrong ids, auth) will not fix itself by retrying.
      log('STOP', msg);
      state.stopped = msg;
      await notify(`⚠️ A1 잡기 봇이 멈췄어요: \`${msg.slice(0, 300)}\`\nClaude 세션에서 확인을 부탁해 주세요.`);
    }
  }
  saveState(state);
}

main().catch(async (e) => {
  log('error', e.message || e);
  const state = loadState();
  // Report an auth/setup problem once, not every two minutes.
  if (e instanceof OciError && (e.status === 401 || e.status === 404) && !state.authWarned) {
    state.authWarned = true;
    saveState(state);
    await notify(`⚠️ A1 잡기 봇이 오라클에 접속하지 못했어요: \`${e.message.slice(0, 300)}\``);
  }
  process.exitCode = 1;
});
