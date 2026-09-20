#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, hashCanonicalJson } from '../cloudflare/heavy-api/src/migration.ts';

export const CONTRACT_PATH = 'work/heavy-schema-transform-contract.v1.json';
export const SOURCE_MIGRATION_ROOT = 'supabase/migrations';
export const TARGET_MIGRATION_ROOT = 'cloudflare/heavy-api/migrations';
export const CONTRACT_SCHEMA = 'heavy-chain-schema-transform-contract.v1';

const STATUSES = new Set(['mapped', 'unmapped', 'decision_required']);
const TABLE_PATTERN = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:public|main)\.)?([a-z_][a-z0-9_]*)\b/gi;
const SOURCE_PATH_PATTERN = /^supabase\/migrations\/[^/]+\.sql$/;
const TARGET_PATH_PATTERN = /^cloudflare\/heavy-api\/migrations\/[^/]+\.sql$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sorted(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function sqlReferencesEntity(root, relativePath, entity) {
  const sql = readFileSync(join(root, relativePath), 'utf8');
  const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(sql);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { __error: error.message };
  }
}

function migrationFiles(root, relativeRoot) {
  const directory = join(root, relativeRoot);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.sql')).sort().map((name) => `${relativeRoot}/${name}`);
}

function tablesInSql(sql) {
  const tables = [];
  for (const match of sql.matchAll(TABLE_PATTERN)) tables.push(match[1].toLowerCase());
  return tables;
}

function sourceInventory(root) {
  const files = migrationFiles(root, SOURCE_MIGRATION_ROOT);
  const evidence = new Map();
  for (const relativePath of files) {
    const sql = readFileSync(join(root, relativePath), 'utf8');
    for (const table of tablesInSql(sql)) {
      const paths = evidence.get(table) ?? [];
      paths.push(relativePath);
      evidence.set(table, paths);
    }
  }
  return new Map(sorted(evidence.keys()).map((key) => [key, sorted(evidence.get(key))]));
}

function targetInventory(root) {
  const files = migrationFiles(root, TARGET_MIGRATION_ROOT);
  const tables = new Set();
  const evidence = new Map();
  for (const relativePath of files) {
    const sql = readFileSync(join(root, relativePath), 'utf8');
    for (const table of tablesInSql(sql)) {
      tables.add(table);
      const paths = evidence.get(table) ?? [];
      paths.push(relativePath);
      evidence.set(table, paths);
    }
  }
  return { files, tables, evidence };
}

function issue(code, sourceEntity, detail) {
  return { code, ...(sourceEntity ? { sourceEntity } : {}), detail };
}

function validateEntry(entry, source, target) {
  const issues = [];
  const name = typeof entry?.sourceEntity === 'string' ? entry.sourceEntity : undefined;
  if (!name) return [issue('invalid_source_entity', undefined, 'sourceEntity must be a non-empty string')];
  if (!STATUSES.has(entry.status)) issues.push(issue('invalid_status', name, 'status must be mapped, unmapped, or decision_required'));
  if (!Array.isArray(entry.evidenceMigrations) || entry.evidenceMigrations.length === 0) {
    issues.push(issue('missing_source_evidence', name, 'evidenceMigrations must not be empty'));
  } else {
    for (const path of entry.evidenceMigrations) {
      if (!SOURCE_PATH_PATTERN.test(path)
        || !existsSync(join(target.root, path))
        || !sqlReferencesEntity(target.root, path, name)) {
        issues.push(issue('invalid_source_evidence', name, path));
      }
    }
  }
  if (entry.status === 'mapped') {
    const mapped = entry.target;
    if (!isRecord(mapped) || mapped.type !== 'table' || !nonEmpty(mapped.name)) {
      issues.push(issue('mapped_target_declaration_required', name, 'mapped entries require target.type=table and target.name'));
    } else {
      const targetName = mapped.name.toLowerCase();
      if (!target.tables.has(targetName)) issues.push(issue('fictional_target', name, mapped.name));
      if (!Array.isArray(mapped.evidenceMigrations) || mapped.evidenceMigrations.length === 0) {
        issues.push(issue('missing_target_evidence', name, 'mapped target evidenceMigrations must not be empty'));
      } else {
        for (const path of mapped.evidenceMigrations) {
          if (!TARGET_PATH_PATTERN.test(path) || !existsSync(join(target.root, path)) || !target.evidence.get(targetName)?.includes(path)) {
            issues.push(issue('invalid_target_evidence', name, path));
          }
        }
      }
    }
    if (!nonEmpty(entry.transformRules?.[0]) || !Array.isArray(entry.transformRules)) issues.push(issue('missing_transform_rules', name, 'mapped entries require transformRules'));
    if (!nonEmpty(entry.idOwner)) issues.push(issue('missing_id_owner', name, 'mapped entries require idOwner declaration'));
    if (!nonEmpty(entry.permissions)) issues.push(issue('missing_permissions', name, 'mapped entries require permissions declaration'));
  }
  return issues;
}

export async function validateHeavySchemaTransformContract(options = {}) {
  const root = resolve(typeof options === 'string' ? options : options.root ?? options.rootDir ?? process.cwd());
  const contractPath = options.contractPath ?? CONTRACT_PATH;
  const contract = readJson(join(root, contractPath));
  const issues = [];
  const source = sourceInventory(root);
  const target = { ...targetInventory(root), root };
  if (contract.__error) issues.push(issue('invalid_contract_json', undefined, contract.__error));
  if (!isRecord(contract) || contract.schema !== CONTRACT_SCHEMA) issues.push(issue('invalid_contract_schema', undefined, CONTRACT_SCHEMA));
  if (!Array.isArray(contract?.entities)) issues.push(issue('missing_entities', undefined, 'entities must be an array'));

  const entities = Array.isArray(contract?.entities) ? contract.entities : [];
  const names = entities.map((entry) => entry?.sourceEntity).filter((name) => typeof name === 'string');
  for (const name of sorted(source.keys())) if (!names.includes(name)) issues.push(issue('missing_source_entity', name, 'source migration table is absent from contract'));
  for (const name of sorted(new Set(names))) if (names.filter((item) => item === name).length > 1) issues.push(issue('duplicate_source_entity', name, 'sourceEntity appears more than once'));
  for (const entry of entities) {
    if (typeof entry?.sourceEntity === 'string' && !source.has(entry.sourceEntity)) issues.push(issue('unknown_source_entity', entry.sourceEntity, 'not declared by current source migrations'));
    issues.push(...validateEntry(entry, source, target));
  }
  issues.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const contractValid = issues.length === 0;
  const migrationPreparationComplete = contractValid && entities.every((entry) => entry.status === 'mapped');
  const counts = {
    sourceEntities: source.size,
    contractEntities: entities.length,
    mapped: entities.filter((entry) => entry.status === 'mapped').length,
    unmapped: entities.filter((entry) => entry.status === 'unmapped').length,
    decisionRequired: entities.filter((entry) => entry.status === 'decision_required').length,
    issues: issues.length,
  };
  return {
    schema: 'heavy-chain-schema-transform-verifier.v1',
    contractPath,
    contractValid,
    migrationPreparationComplete,
    counts,
    sourceEntities: sorted(source.keys()),
    targetEntities: sorted(target.tables),
    issues,
    externalEffects: 'none',
    copyAllowed: false,
    sourceDeleteAllowed: false,
    contractHash: contractValid ? await hashCanonicalJson(contract) : null,
  };
}

export default validateHeavySchemaTransformContract;

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const result = await validateHeavySchemaTransformContract({ rootDir: process.cwd() });
  console.log(JSON.stringify(result, null, 2));
  if (!result.contractValid) process.exitCode = 1;
}
