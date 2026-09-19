/**
 * Generate `THIRD_PARTY_NOTICES.md` from the workspace manifests: every
 * external dependency named by a workspace `package.json`, the vendored-package
 * manifest in `vendor/README.md`, packaged third-party Skill resources, the
 * Python `pyproject.toml` files, and the pnpm patch list. License and repository
 * metadata come from those resources and the installed store, so the tree must
 * be installed. `--check` verifies the committed artifact. Tier policy and
 * ownership live in `.agents/notes/implemented/process/2026-07-30-generated-third-party-notices.md`.
 */

import { createHash } from 'node:crypto'
import { existsSync, globSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { parse as parseToml, type TomlTableWithoutBigInt, type TomlValueWithoutBigInt } from 'smol-toml'
import parseSpdx from 'spdx-expression-parse'
import { browserBundledExternals } from './browser-bundled-externals.ts'

const root = resolve(import.meta.dirname, '..')
const OUT = 'THIRD_PARTY_NOTICES.md'
const PPT_MASTER_ROOT = 'packages/skill/skill-ppt-master/assets/ppt-master'
const PPT_MASTER_VERSION = '6.4.0'
const PPT_MASTER_LICENSE_SHA256 = '80cefc234c1ec12a8cece4344f16300c634fa03df7891686fcf979e3828f0921'
const PPT_MASTER_FILE_COUNT = 12_981
const PPT_MASTER_BYTE_COUNT = 83_654_741

/** Dependency-declaration kinds a consumer resolves at runtime. */
const RUNTIME_KINDS = ['dependencies', 'optionalDependencies'] as const
/** All manifest sections that name an external package this file must disclose. */
const ALL_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

/**
 * Workspace areas that never reach a user: repository tooling and gates (the
 * root manifest), test infrastructure, the documentation site, and the native
 * launcher's build workspace. A runtime
 * declaration by anything outside these areas is a disclosure-relevant
 * runtime dependency because any plugin package can be mounted from a user's
 * `cordis.yml`.
 */
const DEV_ONLY_AREAS = [
  'package.json',
  'packages/test-support/',
  'packages/test-support/client-runtime/',
  'website/',
  'native/',
] as const

/** First-party public native packages: reachable at runtime but not third-party. */
const FIRST_PARTY = new Set([
  '@deepseek-ai/node-addon-system',
  '@deepseek-ai/node-addon-system-darwin-arm64',
  '@deepseek-ai/node-addon-system-darwin-x64',
  '@deepseek-ai/node-addon-system-linux-arm64',
  '@deepseek-ai/node-addon-system-linux-x64',
])

/** Official SDK identity covered by the project's narrow owner authorization. */
export const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
/** Office viewer identity covered by the bundled-extension distribution decision. */
export const OFFICE_VIEWER_PACKAGE = '@huanlin/dsh-plugin-better-sidebar-plugin-office'
/** LGPL equation converter covered by the teacher-workbench distribution decision. */
export const MATHML_PACKAGE = 'mathml2omml'
const MATHML_DISTRIBUTION_ROOT = 'packages/host/teacher-workbench/third-party/mathml2omml'
const MATHML_DISTRIBUTION_SHA256 = {
  'colors.patch': 'c95b38d7f3882bd7ca0c127d901922ac3fbe632ddd1056ced4da17864236874e',
  'COPYING.GPL-3': '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986',
  'COPYING.LGPL-3': 'e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118',
  'COPYING.entities': 'cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164',
  'COPYING.html-parse-stringify': 'f51aa7a410f3d3ff9352a5422b76c072588ac76b63861f59447502caeacacc16',
  'entities-6.0.1.tgz': 'a4de957ab0852f6c91eae59a6000ced5a25a04f0b6e1c3062fbad732a6b5479d',
  'mathml2omml-0.5.0-source.tar.gz': '7c0578339e8af7ef06553a9cc0e5b7500b52905f36d2a8435e34c3c6f9f4b8e9',
} as const
/** Univer integration identity whose commercial dependency closure is disclosed separately. */
export const UNIVER_OFFICE_PACKAGE = 'dsh-univer-office'
/** Direct Univer Pro packages accepted by the bundled-extension distribution decision. */
export const UNIVER_PRO_RUNTIME_PACKAGES = [
  '@univerjs-pro/cli-assets',
  '@univerjs-pro/engine-formula-rust-binding',
  '@univerjs-pro/exchange-node-binding',
] as const
/** Namespaces whose build-time modules the Univer build script inlines into shipped artifacts. */
export const UNIVER_BUNDLED_REVIEW_PREFIXES = ['@univer-cli/', '@univerjs-pro/'] as const
/** Reviewed identity-and-version digest for the bundled modules declared by Univer 0.3.0. */
export const UNIVER_BUNDLED_REVIEW_MANIFEST_SHA256 = '035a1f565386bb26a3031ea592c09cb7a7d4041cfe02cf7c2566d5b6d87d3c22'
const CLAUDE_PLATFORM_PACKAGE_PREFIX = `${CLAUDE_AGENT_SDK_PACKAGE}-`
const CLAUDE_PLATFORM_DECLARED_LICENSE = 'SEE LICENSE IN LICENSE.md'
const UNIVER_COMMERCIAL_LICENSE = 'Univer Commercial License'
const UNIVER_COMMERCIAL_TERMS = 'https://docs.univer.ai/guides/pro/license'
const OWNER_AUTHORIZED_RUNTIME_PACKAGES = new Set([
  CLAUDE_AGENT_SDK_PACKAGE,
  OFFICE_VIEWER_PACKAGE,
  MATHML_PACKAGE,
  ...UNIVER_PRO_RUNTIME_PACKAGES,
])

const LIBREOFFICE_KIT_PACKAGE = '@deepseek-ai/libreoffice-kit'
const LIBREOFFICE_PACKAGES = new Set([
  LIBREOFFICE_KIT_PACKAGE,
  '@deepseek-ai/libreoffice-kit-wasm',
  '@deepseek-ai/libreoffice-kit-darwin-arm64',
  '@deepseek-ai/libreoffice-kit-darwin-x64',
  '@deepseek-ai/libreoffice-kit-win32-arm64',
  '@deepseek-ai/libreoffice-kit-win32-x64',
])

/**
 * Whether a non-permissive runtime declaration has an identity-scoped owner
 * authorization. This does not reclassify its terms as permissive.
 * @param name - exact npm package identity.
 * @returns true only for an exact package identity with a recorded distribution decision.
 */
export function isOwnerAuthorizedRuntime(name: string): boolean {
  return OWNER_AUTHORIZED_RUNTIME_PACKAGES.has(name)
}

/**
 * Metadata overrides where the installed manifest is wrong or unreachable.
 * Each entry documents why the store cannot answer.
 */
const OVERRIDES: Record<string, { license?: string; repo?: string }> = {
  // Rust workspaces publishing npm bins without `license` in package.json.
  'oxlint': { license: 'MIT', repo: 'https://github.com/oxc-project/oxc' },
  'oxlint-tsgolint': { license: 'MIT', repo: 'https://github.com/oxc-project/tsgolint' },
  // `license: SEE LICENSE IN LICENSE`: the servers repo is mid MIT→Apache-2.0
  // relicensing, so the effective terms are per-contribution.
  '@modelcontextprotocol/server-everything': { license: 'MIT / Apache-2.0', repo: 'https://github.com/modelcontextprotocol/servers' },
  '@modelcontextprotocol/server-filesystem': { license: 'MIT / Apache-2.0', repo: 'https://github.com/modelcontextprotocol/servers' },
  // No repository field in the published manifest.
  'node-addon-require-builtin': { repo: 'https://www.npmjs.com/package/node-addon-require-builtin' },
  '@huanlin/dsh-plugin-better-sidebar-plugin-office': { repo: 'https://github.com/HuanLinOTO/dsh-plugin-better-sidebar-plugin-office' },
  'dsh-skill-mcp-panel': { repo: 'https://github.com/Fishquito7/dsh-skill-mcp-panel' },
  // These packages omit license metadata; Univer documents Pro production use
  // under its commercial license instead of an SPDX package license.
  '@univerjs-pro/cli-assets': { license: UNIVER_COMMERCIAL_LICENSE, repo: UNIVER_COMMERCIAL_TERMS },
  '@univerjs-pro/engine-formula-rust-binding': { license: UNIVER_COMMERCIAL_LICENSE, repo: UNIVER_COMMERCIAL_TERMS },
  '@univerjs-pro/exchange-node-binding': { license: UNIVER_COMMERCIAL_LICENSE, repo: UNIVER_COMMERCIAL_TERMS },
}

/**
 * Python metadata is recorded from the distributions' license and project
 * fields; generation does not require installing their wheels. Both Python
 * manifests and the Desktop lock reject names absent from this map.
 */
const PYTHON_METADATA: Record<string, { license: string; repo: string; role?: string }> = {
  pydantic: { license: 'MIT', repo: 'https://github.com/pydantic/pydantic', role: 'runtime dependency of `deepseek-harness-sdk`' },
  hatchling: { license: 'MIT', repo: 'https://github.com/pypa/hatch', role: 'build backend' },
  'et-xmlfile': { license: 'MIT', repo: 'https://foss.heptapod.net/openpyxl/et_xmlfile' },
  lxml: { license: 'BSD-3-Clause', repo: 'https://github.com/lxml/lxml' },
  numpy: { license: 'BSD-3-Clause', repo: 'https://github.com/numpy/numpy' },
  openpyxl: { license: 'MIT', repo: 'https://foss.heptapod.net/openpyxl/openpyxl' },
  pandas: { license: 'BSD-3-Clause', repo: 'https://github.com/pandas-dev/pandas' },
  pillow: { license: 'MIT-CMU', repo: 'https://github.com/python-pillow/Pillow' },
  'python-dateutil': { license: 'Apache-2.0 OR BSD-3-Clause', repo: 'https://github.com/dateutil/dateutil' },
  'python-docx': { license: 'MIT', repo: 'https://github.com/python-openxml/python-docx' },
  'python-pptx': { license: 'MIT', repo: 'https://github.com/scanny/python-pptx' },
  pytest: { license: 'MIT', repo: 'https://github.com/pytest-dev/pytest', role: 'test-only' },
  six: { license: 'MIT', repo: 'https://github.com/benjaminp/six' },
  'typing-extensions': { license: 'PSF-2.0', repo: 'https://github.com/python/typing_extensions' },
  tzdata: { license: 'Apache-2.0', repo: 'https://github.com/python/tzdata' },
  xlsxwriter: { license: 'BSD-2-Clause', repo: 'https://github.com/jmcnamara/XlsxWriter' },
}

type PythonMetadata = typeof PYTHON_METADATA

/** The `package.json` fields this generator reads. */
export interface Manifest {
  name?: string
  version?: string
  private?: boolean
  license?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** One disclosed external npm dependency. */
interface ExternalDep {
  name: string
  license: string
  repo: string
  /** True when some shipped workspace consumer reaches it through runtime dependency edges. */
  runtime: boolean
}

/** Identity and complete-tree inventory for one packaged third-party skill. */
interface BundledSkillDistribution {
  name: string
  version: string
  license: string
  repository: string
  fileCount: number
  byteCount: number
}

/** Read and validate the pinned PPT Master distribution carried by the package. */
function collectPptMasterDistribution(): BundledSkillDistribution {
  const skillRoot = resolve(root, PPT_MASTER_ROOT)
  const skill = readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8')
  const license = readFileSync(resolve(skillRoot, 'LICENSE'))
  const guard = readFileSync(resolve(skillRoot, 'scripts/attribution_guard.py'), 'utf8')
  const required = ['SPONSORS.md', 'SPONSORS_CN.md', 'requirements.txt']
  if (!required.every(path => existsSync(resolve(skillRoot, path)))) {
    throw new Error('gen-third-party-notices: PPT Master attribution or dependency files are incomplete.')
  }
  if (
    !skill.includes(`version: "${PPT_MASTER_VERSION}"`)
    || !skill.includes('license: "MIT"')
    || !skill.includes('official_repository: "https://github.com/hugohe3/ppt-master"')
    || !guard.includes(PPT_MASTER_LICENSE_SHA256)
  ) {
    throw new Error('gen-third-party-notices: PPT Master identity metadata or attribution guard changed.')
  }
  const licenseHash = createHash('sha256').update(license).digest('hex')
  if (licenseHash !== PPT_MASTER_LICENSE_SHA256) {
    throw new Error(`gen-third-party-notices: PPT Master license digest is ${licenseHash}; expected ${PPT_MASTER_LICENSE_SHA256}.`)
  }

  let fileCount = 0
  let byteCount = 0
  for (const entry of readdirSync(skillRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    fileCount++
    byteCount += statSync(resolve(entry.parentPath, entry.name)).size
  }
  if (fileCount !== PPT_MASTER_FILE_COUNT || byteCount !== PPT_MASTER_BYTE_COUNT) {
    throw new Error(
      `gen-third-party-notices: PPT Master inventory is ${fileCount} files and ${byteCount} bytes; expected ${PPT_MASTER_FILE_COUNT} files and ${PPT_MASTER_BYTE_COUNT} bytes.`,
    )
  }
  return {
    name: 'PPT Master',
    version: PPT_MASTER_VERSION,
    license: 'MIT',
    repository: 'https://github.com/hugohe3/ppt-master',
    fileCount,
    byteCount,
  }
}

/** Read and parse a workspace-relative `package.json`. */
function readManifest(rel: string): Manifest {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as Manifest
}

/**
 * Manifest globs, derived from the workspace declarations rather than listed
 * here, so a new member area (`tools/*`) is read the day it is declared.
 * @returns one glob per manifest-bearing location, repository-relative.
 */
export function manifestPatterns(rootMembers: readonly string[]): string[] {
  return [
    'package.json',
    ...rootMembers.map(member => `${member}/package.json`),
  ]
}

/** The `packages:` member globs declared by one pnpm workspace file. */
function workspaceMembers(rel: string): string[] {
  const declared = (yaml.load(readFileSync(resolve(root, rel), 'utf8')) as { packages?: unknown }).packages
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`gen-third-party-notices: ${rel} declares no workspace members; the manifest set cannot be derived.`)
  }
  return declared.map(member => String(member))
}

/**
 * Every workspace manifest, keyed by repository-relative path, plus the set of
 * workspace package names. Paths are normalized to `/` at ingestion: Node's
 * `fs.globSync` returns OS-native separators, and the area matching in
 * `tierExternalDeps` compares `/`-suffixed prefixes, so Windows backslashes
 * would silently push dev-area manifests into the runtime tier.
 */
function loadWorkspaceManifests(): { manifests: Map<string, Manifest>; names: Set<string> } {
  const patterns = manifestPatterns(workspaceMembers('pnpm-workspace.yaml'))
  const manifests = new Map<string, Manifest>()
  const names = new Set<string>()
  for (const pattern of patterns) {
    for (const path of globSync(pattern, { cwd: root })) {
      const normalized = path.replaceAll('\\', '/')
      const manifest = readManifest(normalized)
      manifests.set(normalized, manifest)
      if (manifest.name !== undefined) names.add(manifest.name)
    }
  }
  if (manifests.size < 100) throw new Error(`gen-third-party-notices: only ${manifests.size} workspace manifests found; the glob set is stale.`)
  return { manifests, names }
}

type VirtualManifest = Manifest & {
  claudeCodeVersion?: string
  license?: string
  repository?: string | { url?: string }
  homepage?: string
}

/** One platform payload declared by the official Claude Agent SDK. */
export interface ClaudePlatformPayload {
  readonly name: string
  readonly version: string
}

/** Current SDK and CLI distribution facts derived from the installed SDK manifest. */
export interface ClaudeDistribution {
  readonly sdkVersion: string
  readonly claudeCodeVersion: string
  readonly payloads: ClaudePlatformPayload[]
}

/** One package in the commercial Univer runtime closure. */
export interface UniverCommercialPackage {
  readonly name: string
  readonly version: string
  readonly role: 'runtime dependency' | 'optional platform payload' | 'bundled artifact module'
}

/** Plugin and package facts derived from the pinned Univer integration. */
export interface UniverCommercialDistribution {
  readonly pluginVersion: string
  readonly packages: UniverCommercialPackage[]
}

function requiredManifestString(
  value: string | undefined,
  field: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} has no ${field}.`)
  }
  return value
}

/** Read the exact authorized Univer Pro dependencies from the integration manifest. */
function univerCommercialRootDependencies(
  manifest: Manifest,
): [name: string, version: string][] {
  if (manifest.name !== UNIVER_OFFICE_PACKAGE) {
    throw new Error(
      `gen-third-party-notices: expected ${UNIVER_OFFICE_PACKAGE} manifest, got ${JSON.stringify(manifest.name)}.`,
    )
  }
  const dependencies = manifest.dependencies ?? {}
  const declared = Object.entries(dependencies)
    .filter(([name]) => name.startsWith('@univerjs-pro/'))
    .sort(([left], [right]) => left.localeCompare(right))
  const expected = [...UNIVER_PRO_RUNTIME_PACKAGES].sort()
  const declaredNames = declared.map(([name]) => name)
  if (declaredNames.join('\n') !== expected.join('\n')) {
    throw new Error(
      `gen-third-party-notices: ${UNIVER_OFFICE_PACKAGE} commercial runtime set is ${declaredNames.join(', ') || '(empty)'}; expected ${expected.join(', ')}.`,
    )
  }
  return declared.map(([name, version]) => {
    if (version.length === 0) {
      throw new Error(`gen-third-party-notices: ${UNIVER_OFFICE_PACKAGE} has no version for ${name}.`)
    }
    return [name, version]
  })
}

/** Read Univer modules that the plugin build declares for artifact bundling. */
export function univerBundledReviewedPackagesFromManifest(
  manifest: Manifest,
): UniverCommercialPackage[] {
  const packages = Object.entries(manifest.devDependencies ?? {})
    .filter(([name]) => UNIVER_BUNDLED_REVIEW_PREFIXES.some(prefix => name.startsWith(prefix)))
    .map(([name, version]) => ({ name, version, role: 'bundled artifact module' as const }))
    .sort((left, right) => left.name.localeCompare(right.name))
  if (!UNIVER_BUNDLED_REVIEW_PREFIXES.every(prefix => packages.some(entry => entry.name.startsWith(prefix)))) {
    throw new Error(
      `gen-third-party-notices: ${UNIVER_OFFICE_PACKAGE} must declare bundled modules in ${UNIVER_BUNDLED_REVIEW_PREFIXES.join(' and ')}.`,
    )
  }
  return packages
}

/** Hash the exact build-time identities and versions reviewed for one Univer artifact. */
export function univerBundledReviewManifestHash(manifest: Manifest): string {
  const declarations = univerBundledReviewedPackagesFromManifest(manifest)
    .map(entry => `${entry.name}@${entry.version}`)
    .join('\n')
  return createHash('sha256').update(declarations).digest('hex')
}

/**
 * Derive the commercial Univer package closure from the integration and its
 * direct Pro package manifests. Native payload identities come only from each
 * binding package's own `optionalDependencies` namespace.
 * @param pluginManifest - pinned `dsh-univer-office` manifest.
 * @param runtimeManifests - installed manifests for its direct Univer Pro dependencies.
 * @returns exact external, optional-platform, and artifact-bundled package identities and versions.
 */
export function univerCommercialDistributionFromManifests(
  pluginManifest: Manifest,
  runtimeManifests: readonly Manifest[],
): UniverCommercialDistribution {
  const pluginVersion = pluginManifest.version
  if (pluginVersion === undefined || pluginVersion.length === 0) {
    throw new Error(`gen-third-party-notices: ${UNIVER_OFFICE_PACKAGE} has no version.`)
  }
  const roots = univerCommercialRootDependencies(pluginManifest)
  const manifests = new Map(runtimeManifests.map(manifest => [manifest.name, manifest]))
  const packages = univerBundledReviewedPackagesFromManifest(pluginManifest)
  for (const [name, version] of roots) {
    const manifest = manifests.get(name)
    if (manifest?.version !== version) {
      throw new Error(
        `gen-third-party-notices: installed ${name} does not match the ${version} version declared by ${UNIVER_OFFICE_PACKAGE}.`,
      )
    }
    packages.push({ name, version, role: 'runtime dependency' })
    const optionals = Object.entries(manifest.optionalDependencies ?? {})
    for (const [payloadName, payloadVersion] of optionals) {
      if (!payloadName.startsWith(`${name}-`)) {
        throw new Error(
          `gen-third-party-notices: ${name} optional dependency ${payloadName} is outside its authorized platform-payload identity.`,
        )
      }
      if (payloadVersion.length === 0) {
        throw new Error(`gen-third-party-notices: ${name} has no version for ${payloadName}.`)
      }
      packages.push({
        name: payloadName,
        version: payloadVersion,
        role: 'optional platform payload',
      })
    }
  }
  packages.sort((left, right) => left.name.localeCompare(right.name))
  return { pluginVersion, packages }
}

/**
 * Derive the official platform payload set without a version or platform
 * allowlist. Only identities in the SDK's own package namespace are covered.
 * @param manifest - installed official SDK manifest.
 * @returns current SDK, CLI, and optional platform payload facts.
 */
export function claudeDistributionFromManifest(
  manifest: VirtualManifest,
): ClaudeDistribution {
  if (manifest.name !== CLAUDE_AGENT_SDK_PACKAGE) {
    throw new Error(
      `gen-third-party-notices: expected ${CLAUDE_AGENT_SDK_PACKAGE} manifest, got ${JSON.stringify(manifest.name)}.`,
    )
  }
  const sdkVersion = requiredManifestString(manifest.version, 'version')
  const claudeCodeVersion = requiredManifestString(
    manifest.claudeCodeVersion,
    'claudeCodeVersion',
  )
  const entries = Object.entries(manifest.optionalDependencies ?? {})
  if (entries.length === 0) {
    throw new Error(
      `gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} declares no optional platform payloads.`,
    )
  }
  const payloads = entries.map(([name, version]) => {
    if (!name.startsWith(CLAUDE_PLATFORM_PACKAGE_PREFIX)) {
      throw new Error(
        `gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} optional dependency ${name} is outside its authorized platform-payload identity.`,
      )
    }
    return {
      name,
      version: requiredManifestString(version, `${name} optional dependency version`),
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
  return { sdkVersion, claudeCodeVersion, payloads }
}

/**
 * Resolve one package's manifest inside a pnpm virtual store. The prefix scan
 * matches ordinary `@scope+name@version` directory names; pnpm 11 truncates
 * long names (a peer-suffixed name past the length limit becomes
 * `<prefix>_<hash>`), so a content scan falls back over the whole store when
 * the prefix misses.
 *
 * @param virtual - the `.pnpm` virtual store directory to scan.
 * @param name - the external package name, exactly as `node_modules` spells it.
 * @param expectedVersion - exact version required when the store retains more than one.
 * @returns the parsed manifest, or `undefined` when neither the prefix match
 *   nor the content scan finds the requested package version.
 */
export function virtualManifest(
  virtual: string,
  name: string,
  expectedVersion?: string,
): VirtualManifest | undefined {
  const prefix = `${name.replace('/', '+')}@`
  const entries = readdirSync(virtual)
  for (const entry of entries.filter(dir => dir.startsWith(prefix))) {
    const manifest = JSON.parse(readFileSync(resolve(virtual, entry, 'node_modules', name, 'package.json'), 'utf8')) as VirtualManifest
    if (expectedVersion === undefined || manifest.version === expectedVersion) return manifest
  }
  for (const dir of entries) {
    const candidate = resolve(virtual, dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as VirtualManifest
      if (expectedVersion === undefined || manifest.version === expectedVersion) return manifest
    }
  }
  return undefined
}

const workspaceLinkedManifestCache = new Map<string, VirtualManifest | undefined>()

/**
 * Resolve the package version selected for a declaring workspace instead of an
 * unrelated historical version that still occupies the shared virtual store.
 * @param name - external package identity.
 * @param manifests - workspace manifests already loaded by the caller, so one
 *   load serves every dependency instead of a full re-read per name.
 * @returns the first current workspace link for that package, when installed.
 */
function workspaceLinkedManifest(name: string, manifests: Map<string, Manifest>): VirtualManifest | undefined {
  if (workspaceLinkedManifestCache.has(name)) return workspaceLinkedManifestCache.get(name)
  for (const [path, manifest] of manifests) {
    if (!ALL_KINDS.some(kind => name in (manifest[kind] ?? {}))) continue
    const linked = resolve(root, dirname(path), 'node_modules', name, 'package.json')
    if (!existsSync(linked)) continue
    const found = JSON.parse(readFileSync(linked, 'utf8')) as VirtualManifest
    workspaceLinkedManifestCache.set(name, found)
    return found
  }
  workspaceLinkedManifestCache.set(name, undefined)
  return undefined
}

/** Resolve one installed external package manifest from either pnpm store. */
function installedManifest(name: string, manifests: Map<string, Manifest>, expectedVersion?: string): VirtualManifest | undefined {
  const linked = workspaceLinkedManifest(name, manifests)
  if (linked !== undefined && (expectedVersion === undefined || linked.version === expectedVersion)) return linked
  let manifest: (Manifest & { license?: string; repository?: string | { url?: string }; homepage?: string }) | undefined
  // Workspace-local link farms can expose a dependency that is not linked at
  // the repository root; both are backed by the root workspace's lockfile.
  for (const store of ['node_modules', 'native/system/node_modules']) {
    const direct = resolve(root, store, name, 'package.json')
    if (existsSync(direct)) {
      const candidate = JSON.parse(readFileSync(direct, 'utf8')) as typeof manifest
      if (expectedVersion === undefined || candidate?.version === expectedVersion) {
        manifest = candidate
        break
      }
    }
    const virtual = resolve(root, store, '.pnpm')
    if (!existsSync(virtual)) continue
    manifest = virtualManifest(virtual, name, expectedVersion)
    if (manifest !== undefined) break
  }
  return manifest
}

/** License and repository URL for an installed external package, from the pnpm store. */
function installedMetadata(name: string, manifests: Map<string, Manifest>): { license: string; repo: string } {
  const override = OVERRIDES[name]
  const manifest = installedManifest(name, manifests)
  const license = override?.license ?? manifest?.license
  const rawRepo = typeof manifest?.repository === 'string' ? manifest.repository : manifest?.repository?.url ?? manifest?.homepage
  const repo = override?.repo ?? normalizeRepo(rawRepo)
  if (license === undefined || repo === undefined) {
    throw new Error(`gen-third-party-notices: cannot resolve ${license === undefined ? 'license' : 'repository'} for ${name}; run \`pnpm install\`, or add an OVERRIDES entry.`)
  }
  return { license, repo }
}

function collectClaudeDistribution(manifests: Map<string, Manifest>): ClaudeDistribution {
  const manifest = installedManifest(CLAUDE_AGENT_SDK_PACKAGE, manifests)
  if (manifest === undefined) {
    throw new Error(
      `gen-third-party-notices: cannot resolve ${CLAUDE_AGENT_SDK_PACKAGE}; run \`pnpm install\`.`,
    )
  }
  const distribution = claudeDistributionFromManifest(manifest)
  let installedPayloads = 0
  for (const payload of distribution.payloads) {
    const installed = installedManifest(payload.name, manifests, payload.version)
    if (installed === undefined) continue
    installedPayloads += 1
    if (
      installed.name !== payload.name
      || installed.version !== payload.version
      || installed.license !== CLAUDE_PLATFORM_DECLARED_LICENSE
    ) {
      throw new Error(
        `gen-third-party-notices: installed ${payload.name} does not match its SDK-declared version and ${CLAUDE_PLATFORM_DECLARED_LICENSE} license field.`,
      )
    }
  }
  if (installedPayloads === 0) {
    throw new Error(
      'gen-third-party-notices: no SDK-declared Claude platform payload is installed; install optional dependencies before regenerating.',
    )
  }
  return distribution
}

/** Resolve and verify the installed commercial Univer dependency closure. */
function collectUniverCommercialDistribution(manifests: Map<string, Manifest>): UniverCommercialDistribution {
  const plugin = installedManifest(UNIVER_OFFICE_PACKAGE, manifests)
  if (plugin === undefined) {
    throw new Error(
      `gen-third-party-notices: cannot resolve ${UNIVER_OFFICE_PACKAGE}; run \`pnpm install\`.`,
    )
  }
  const bundledHash = univerBundledReviewManifestHash(plugin)
  if (bundledHash !== UNIVER_BUNDLED_REVIEW_MANIFEST_SHA256) {
    throw new Error(
      `gen-third-party-notices: ${UNIVER_OFFICE_PACKAGE} bundled module manifest is ${bundledHash}; review the artifact and update UNIVER_BUNDLED_REVIEW_MANIFEST_SHA256.`,
    )
  }
  const roots = univerCommercialRootDependencies(plugin).map(([name, version]) => {
    const manifest = installedManifest(name, manifests, version)
    if (manifest === undefined) {
      throw new Error(
        `gen-third-party-notices: cannot resolve ${name}@${version}; run \`pnpm install\`.`,
      )
    }
    return manifest
  })
  const distribution = univerCommercialDistributionFromManifests(plugin, roots)
  const payloads = distribution.packages.filter(entry => entry.role === 'optional platform payload')
  if (payloads.length > 0 && !payloads.some(payload => installedManifest(payload.name, manifests, payload.version) !== undefined)) {
    throw new Error(
      'gen-third-party-notices: no Univer binding platform payload is installed; install optional dependencies before regenerating.',
    )
  }
  return distribution
}

/** Normalize a manifest repository/homepage value to a browsable https URL. */
function normalizeRepo(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  let url = raw
    .replace(/^git\+ssh:\/\/git@/, 'https://')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git$/, '')
  if (!url.startsWith('http')) url = `https://github.com/${url}`
  return url
}

/**
 * Direct npm dependencies distributed through installed runtime libraries or
 * browser builds. Tooling declarations alone do not imply distribution.
 */
function collectNpmDeps(manifests: Map<string, Manifest>, names: Set<string>, browser: ReadonlySet<string>): ExternalDep[] {
  return [...tierExternalDeps(manifests, names, browser)]
    .filter(([name]) => !FIRST_PARTY.has(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, runtime]) => ({ name, ...installedMetadata(name, manifests), runtime }))
}

/**
 * Tier every external dependency the workspace declares.
 * @param manifests - workspace manifests keyed by repository-relative path.
 * @param names - every workspace package name, which never counts as external.
 * @param browser - Direct third-party packages resolved by the browser builds.
 * @returns each external package mapped to whether it is a runtime dependency.
 */
export function tierExternalDeps(
  manifests: Map<string, Manifest>, names: Set<string>, browser: ReadonlySet<string> = new Set(),
): Map<string, boolean> {
  const tiers = new Map<string, boolean>()
  // `tsx` is runtime by fiat: the root source-run scripts execute through its ESM hook.
  tiers.set('tsx', true)
  for (const [path, manifest] of manifests) {
    const devOnly = DEV_ONLY_AREAS.some(area => (area.endsWith('/') ? path.startsWith(area) : path === area))
    for (const kind of ALL_KINDS) {
      for (const [dep, range] of Object.entries(manifest[kind] ?? {})) {
        if (names.has(dep) || range.startsWith('workspace:')) continue
        const runtime = browser.has(dep) || !devOnly && (RUNTIME_KINDS as readonly string[]).includes(kind)
        tiers.set(dep, (tiers.get(dep) ?? false) || runtime)
      }
    }
  }
  for (const name of browser) {
    if (!names.has(name) && !tiers.has(name)) throw new Error(`gen-third-party-notices: browser package ${name} has no workspace dependency declaration`)
  }
  return tiers
}

/** A vendored package row parsed out of the `vendor/README.md` manifest table. */
export interface VendoredRow {
  npmName: string
  /** The name this package carries upstream; MIT attribution names the fork's origin, not our scope. */
  upstreamName: string
  upstream: string
}

/**
 * Parse the vendored-package manifest table out of `vendor/README.md`.
 * @param text - the complete `vendor/README.md` contents.
 * @returns one row per manifest-table entry, in table order.
 */
export function parseVendoredRows(text: string): VendoredRow[] {
  const rows: VendoredRow[] = []
  for (const line of text.split('\n')) {
    const match = new RegExp(String.raw`^\| \x60\S+\/\x60 \| \x60([^\x60]+)\x60 \| \x60([^\x60]+)\x60 \| \S+ \| `
      + String.raw`(https:\/\/\S+?)(?: \([^)]*\))? \| \x60[0-9a-f]+\x60 \|$`).exec(line)
    if (match === null) continue
    const [, npmName, upstreamName, upstream] = match
    if (npmName === undefined || upstreamName === undefined || upstream === undefined) continue
    rows.push({ npmName, upstreamName, upstream })
  }
  return rows
}

/**
 * Parse the vendored manifest table and confirm it accounts for every vendored
 * directory. The `vendor/` tree — not the table — is the set that must be
 * disclosed, so a row that stops matching the table format is a hard error
 * rather than a package that quietly vanishes from the notices.
 */
function collectVendored(): (VendoredRow & { sourceDirectory: string })[] {
  const rows = parseVendoredRows(readFileSync(resolve(root, 'vendor/README.md'), 'utf8'))
  const onDisk = new Map<string, string>()
  for (const entry of readdirSync(resolve(root, 'vendor'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = readManifest(`vendor/${entry.name}/package.json`)
    if (manifest.name !== undefined) onDisk.set(manifest.name, entry.name)
  }

  const parsed = new Set(rows.map(row => row.npmName))
  const missing = [...onDisk.keys()].filter(name => !parsed.has(name))
  if (missing.length > 0) {
    throw new Error(`gen-third-party-notices: vendor/README.md has no manifest-table row for ${missing.join(', ')}; its table format changed or the sync is incomplete.`)
  }
  return rows.map((row) => {
    const dir = onDisk.get(row.npmName)
    if (dir === undefined) throw new Error(`gen-third-party-notices: vendored package ${row.npmName} from vendor/README.md has no vendor/ directory.`)
    const license = readManifest(`vendor/${dir}/package.json`).license
    if (license !== 'MIT') {
      throw new Error(`gen-third-party-notices: vendored ${row.npmName} declares license ${JSON.stringify(license)}; the vendored section assumes MIT throughout.`)
    }
    return { ...row, sourceDirectory: `vendor/${dir}` }
  })
}

/** Whether a parsed TOML value is a table rather than an array or scalar. */
function isTomlTable(value: TomlValueWithoutBigInt | undefined): value is TomlTableWithoutBigInt {
  return value !== undefined && typeof value === 'object' && !Array.isArray(value)
}

/** Parse one PEP 508 requirement string into its distribution name. */
function parsePythonRequirement(requirement: string): string {
  const name = /^\s*([a-zA-Z][a-zA-Z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~;@].*)?$/.exec(requirement)?.[1]
  if (name === undefined) {
    throw new Error(`gen-third-party-notices: cannot read a distribution name from the requirement ${JSON.stringify(requirement)}.`)
  }
  return name
}

/** Add the string requirements from one parsed TOML array. */
function collectPythonRequirementArray(
  names: string[],
  value: TomlValueWithoutBigInt | undefined,
  location: string,
  allowGroupIncludes = false,
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new Error(`gen-third-party-notices: ${location} must be an array.`)
  }
  for (const item of value) {
    if (typeof item === 'string') {
      names.push(parsePythonRequirement(item))
      continue
    }
    if (allowGroupIncludes && isTomlTable(item) && typeof item['include-group'] === 'string' && Object.keys(item).length === 1) {
      continue
    }
    throw new Error(`gen-third-party-notices: ${location} contains an unsupported requirement entry.`)
  }
}

/** Read an optional TOML table and reject a present non-table value. */
function optionalTomlTable(value: TomlValueWithoutBigInt | undefined, location: string): TomlTableWithoutBigInt | undefined {
  if (value === undefined || isTomlTable(value)) return value
  throw new Error(`gen-third-party-notices: ${location} must be a table.`)
}

/**
 * Parse a `pyproject.toml` project identity and every requirement it declares:
 * `requires` under
 * `[build-system]`, `dependencies` under `[project]`, and every key under
 * `[project.optional-dependencies]` and `[dependency-groups]`. A TOML parser
 * owns comments, quoted keys, escapes, and array boundaries; unsupported
 * requirement forms fail instead of disappearing from the notices.
 * @param text - the complete `pyproject.toml` contents.
 * @returns the local project name and declared requirement names.
 */
function parsePyproject(text: string): { projectName?: string; requirements: string[] } {
  const names: string[] = []
  const document = parseToml(text, { integersAsBigInt: false })
  const buildSystem = optionalTomlTable(document['build-system'], '[build-system]')
  const project = optionalTomlTable(document.project, '[project]')
  const projectName = project?.name
  if (projectName !== undefined && typeof projectName !== 'string') {
    throw new Error('gen-third-party-notices: [project].name must be a string.')
  }
  collectPythonRequirementArray(names, buildSystem?.requires, '[build-system].requires')
  collectPythonRequirementArray(names, project?.dependencies, '[project].dependencies')

  const optional = optionalTomlTable(project?.['optional-dependencies'], '[project.optional-dependencies]')
  for (const [group, requirements] of Object.entries(optional ?? {})) {
    collectPythonRequirementArray(names, requirements, `[project.optional-dependencies].${group}`)
  }

  const groups = optionalTomlTable(document['dependency-groups'], '[dependency-groups]')
  for (const [group, requirements] of Object.entries(groups ?? {})) {
    collectPythonRequirementArray(names, requirements, `[dependency-groups].${group}`, true)
  }
  return projectName === undefined
    ? { requirements: names }
    : { projectName, requirements: names }
}

/**
 * Read every requirement name declared by one `pyproject.toml`.
 * @param text - the complete `pyproject.toml` contents.
 * @returns each declared requirement's distribution name, in file order.
 */
export function parsePyprojectRequirements(text: string): string[] {
  return parsePyproject(text).requirements
}

/** Normalize a Python distribution name according to the packaging name rule. */
function normalizePythonDistributionName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Resolve external Python dependencies after excluding local project names.
 * @param pyprojects - complete local `pyproject.toml` contents.
 * @param metadata - disclosure metadata for every external dependency.
 * @returns disclosed dependencies in normalized name order.
 */
export function collectPythonDependencies(
  pyprojects: string[],
  metadata: PythonMetadata = PYTHON_METADATA,
): { name: string; license: string; repo: string; role: string }[] {
  const parsed = pyprojects.map(parsePyproject)
  const firstParty = new Set(parsed.flatMap(({ projectName }) => (
    projectName === undefined ? [] : [normalizePythonDistributionName(projectName)]
  )))
  const found = new Set(parsed
    .flatMap(({ requirements }) => requirements.map(normalizePythonDistributionName))
    .filter(name => !firstParty.has(name)))
  return [...found].sort((a, b) => a.localeCompare(b)).map((name) => {
    const entry = metadata[name]
    if (entry === undefined) throw new Error(`gen-third-party-notices: python dependency ${name} is missing from PYTHON_METADATA.`)
    return { name, ...entry, role: entry.role ?? 'Python project dependency' }
  })
}

/** Direct Python dependencies named by the `pyproject.toml` manifests under `python/`. */
function collectPython(): { name: string; license: string; repo: string; role: string }[] {
  const manifests = globSync('python/*/pyproject.toml', { cwd: root })
  if (manifests.length === 0) throw new Error('gen-third-party-notices: no python/*/pyproject.toml found; the Python tree moved.')
  return collectPythonDependencies(manifests.map(path => readFileSync(resolve(root, path), 'utf8')))
}

/**
 * Disclose every Desktop wheel distribution using its locked version, rejecting duplicate normalized names.
 * @param packages - Distribution names and exact versions from the Desktop runtime lock.
 * @param metadata - License and source metadata for every locked distribution.
 * @returns Normalized, sorted distribution identities with versions and licenses.
 */
export function collectDesktopPythonDependencies(
  packages: Readonly<Record<string, string>>,
  metadata: PythonMetadata = PYTHON_METADATA,
): { name: string; version: string; license: string; repo: string }[] {
  const normalized = new Map<string, string>()
  for (const [distribution, version] of Object.entries(packages)) {
    const name = normalizePythonDistributionName(distribution)
    const previous = normalized.get(name)
    if (previous !== undefined && previous !== version) {
      throw new Error(`gen-third-party-notices: Desktop python distribution ${name} has conflicting locked versions.`)
    }
    if (previous !== undefined) throw new Error(`gen-third-party-notices: Desktop python distribution ${name} has duplicate normalized names.`)
    normalized.set(name, version)
  }
  return [...normalized].sort(([a], [b]) => a.localeCompare(b)).map(([name, version]) => {
    const entry = metadata[name]
    if (entry === undefined) throw new Error(`gen-third-party-notices: Desktop python distribution ${name} is missing from PYTHON_METADATA.`)
    return { name, version, license: entry.license, repo: entry.repo }
  })
}

/** pnpm-patched external packages, from `pnpm-workspace.yaml`. */
function collectPatched(): { spec: string; patch: string }[] {
  const workspace = yaml.load(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as { patchedDependencies?: Record<string, string> }
  return Object.entries(workspace.patchedDependencies ?? {}).map(([spec, patch]) => ({ spec, patch }))
}

/** SPDX identifiers this project may ship without further review. */
const PERMISSIVE_LICENSES = new Set(['MIT', 'MIT-CMU', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'PSF-2.0'])

/** Evaluate a parsed SPDX expression under the repository's license policy. */
function isPermissiveSpdx(expression: ReturnType<typeof parseSpdx>): boolean {
  if ('conjunction' in expression) {
    return expression.conjunction === 'and'
      ? isPermissiveSpdx(expression.left) && isPermissiveSpdx(expression.right)
      : isPermissiveSpdx(expression.left) || isPermissiveSpdx(expression.right)
  }
  return expression.plus !== true
    && expression.exception === undefined
    && PERMISSIVE_LICENSES.has(expression.license)
}

/**
 * Whether an SPDX expression grants terms this project may ship under.
 * `OR` needs one permissive alternative, because the consumer chooses; `AND`
 * needs all of them, because every obligation applies. Anything that is not a
 * recognized permissive identifier — copyleft, an exception clause, or a
 * license this list has never seen — evaluates to false, so an unfamiliar
 * expression fails closed rather than passing on a partial match.
 * @param license - the SPDX expression from the package manifest.
 * @returns true when the expression's obligations are all permissive.
 */
export function isPermissive(license: string): boolean {
  // Some npm manifests use a slash for a choice despite SPDX requiring `OR`.
  const normalized = license.replace(/\s*\/\s*/g, ' OR ').trim()
  try {
    return isPermissiveSpdx(parseSpdx(normalized))
  } catch {
    return false
  }
}

/**
 * Reject unapproved non-permissive licenses on installed or browser-bundled code.
 * @param dependencies - Disclosed runtime package identities and declared licenses.
 * @throws When a runtime package has no permissive license or exact owner authorization.
 */
export function assertRuntimeLicenses(dependencies: readonly { name: string; license: string }[]): void {
  const rejected = dependencies.filter(dep => !isPermissive(dep.license)
    && !isOwnerAuthorizedRuntime(dep.name)
    && !(LIBREOFFICE_PACKAGES.has(dep.name) && dep.license === 'MPL-2.0'))
  if (rejected.length > 0) {
    throw new Error(`gen-third-party-notices: runtime ${rejected.map(dep => `${dep.name} (${dep.license})`).join(', ')} is not a permissive license; review the distribution terms and record the decision before regenerating.`)
  }
}

/**
 * Render the sentence that isolates non-permissive development tooling, or
 * nothing at all when every development dependency is permissive.
 * @param deps - development dependencies whose license is not permissive.
 * @returns the paragraph to place after the development table.
 */
function renderNonPermissiveNote(deps: ExternalDep[]): string {
  if (deps.length === 0) return ''
  const named = deps.map(dep => `\`${dep.name}\` (${dep.license})`)
  const subject = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
  return `\n${subject} ${named.length === 1 ? 'runs' : 'run'} only as development tooling; their code is not linked into or distributed with any DeepSeek Harness artifact.\n`
}

/** Render one npm dependency table. */
function renderNpmTable(deps: ExternalDep[]): string {
  const lines = ['| Package | License |', '| --- | --- |']
  for (const dep of deps) lines.push(`| [\`${dep.name}\`](${dep.repo}) | ${dep.license} |`)
  return lines.join('\n')
}

function renderClaudeDistribution(
  distribution: ClaudeDistribution | undefined,
): string {
  if (distribution === undefined) return ''
  const rows = distribution.payloads.map(payload =>
    `| [\`${payload.name}\`](https://www.npmjs.com/package/${payload.name}) | ${payload.version} | ${CLAUDE_PLATFORM_DECLARED_LICENSE} |`,
  )
  return `
## Official Claude Code platform payloads

The project owner authorizes distribution of every version of the official \`${CLAUDE_AGENT_SDK_PACKAGE}\` package and the official Claude Code CLI/platform payloads that each version declares through \`optionalDependencies\`. This identity-scoped authorization does not classify their declared terms as permissive and does not cover any unrelated runtime package; version, declared-license, and payload-set changes still require the ordinary dependency, lockfile, compatibility, terms, and notices review.

The installed SDK ${distribution.sdkVersion} declares the following optional platform packages. Each carries the official Claude Code ${distribution.claudeCodeVersion} executable; the package identities and versions come from the SDK manifest, while the declared license field is verified against the platform payload installed for the current host.

| Optional platform package | Version | Declared license |
| --- | --- | --- |
${rows.join('\n')}
`
}

/** Render the explicit non-permissive Office distribution authorization. */
function renderOfficeDistribution(deps: ExternalDep[]): string {
  const office = deps.find(dep => dep.name === OFFICE_VIEWER_PACKAGE)
  if (office === undefined) return ''
  return `
\`${OFFICE_VIEWER_PACKAGE}\` (${office.license}) is distributed by the explicit identity-scoped decision in [Bundled extensions and shared speech input](.agents/notes/implemented/feature/2026-08-25-bundled-extensions-and-qq-speech.md). This authorization does not classify its terms as permissive; downstream distributions must preserve its notices and comply with that license.
`
}

/**
 * Verify the approved converter version and its shipped source and license resources.
 * @param manifest - installed converter manifest.
 * @param distributionRoot - directory containing corresponding source, terms, and replacement instructions.
 * @returns nothing; throws when package identity, version, license, or distribution resources differ from the reviewed release.
 */
export function verifyMathmlDistribution(manifest: Manifest, distributionRoot: string): void {
  if (manifest.name !== MATHML_PACKAGE || manifest.version !== '0.5.0' || manifest.license !== 'LGPL-3.0-or-later') {
    throw new Error('gen-third-party-notices: mathml2omml identity, version, or license changed; review its distribution and corresponding source.')
  }
  for (const [file, expected] of Object.entries(MATHML_DISTRIBUTION_SHA256)) {
    const digest = createHash('sha256').update(readFileSync(resolve(distributionRoot, file))).digest('hex')
    if (digest !== expected) {
      throw new Error(`gen-third-party-notices: mathml2omml ${file} differs from the reviewed distribution.`)
    }
  }
  if (readFileSync(resolve(distributionRoot, 'NOTICE.txt'), 'utf8').trim().length === 0) {
    throw new Error('gen-third-party-notices: mathml2omml replacement instructions are empty.')
  }
}

/** Render the pinned LGPL distribution and its corresponding-source location. */
function renderMathmlDistribution(deps: ExternalDep[], manifests: Map<string, Manifest>): string {
  if (!deps.some(dep => dep.name === MATHML_PACKAGE)) return ''
  const manifest = installedManifest(MATHML_PACKAGE, manifests)
  if (manifest === undefined) throw new Error('gen-third-party-notices: cannot resolve mathml2omml; run `pnpm install`.')
  verifyMathmlDistribution(manifest, resolve(root, MATHML_DISTRIBUTION_ROOT))
  return `
## Editable Word equations

The teacher workbench uses [\`mathml2omml\`](https://github.com/fiduswriter/mathml2omml) 0.5.0 by Johannes Wilm under LGPL-3.0-or-later. The project owner explicitly authorizes this version's distribution under those terms in the [example-collection decision](.agents/notes/implemented/feature/2026-09-08-example-collection.md). The converter remains an external, replaceable runtime module. Users may modify it and reverse engineer the combined application to debug those modifications.

Every teacher-workbench package includes [the notice and replacement instructions](${MATHML_DISTRIBUTION_ROOT}/NOTICE.txt), the complete GPL and LGPL texts, and the [unmodified corresponding source](${MATHML_DISTRIBUTION_ROOT}/mathml2omml-0.5.0-source.tar.gz) from upstream commit \`0ddeb8b59ff1a97796b25d8f682dfb410febde1d\`. The accompanying [equation-formatting source patch](${MATHML_DISTRIBUTION_ROOT}/colors.patch) supplies the local changes and is applied before rebuilding. The packet also contains the bundled \`entities\` 6.0.1 source under BSD-2-Clause and the MIT notice for the parser derived from \`html-parse-stringify\`. The Windows installer includes the same packet under \`resources/app/node_modules/@deepseek-ai/dsh-host-teacher-workbench/third-party/mathml2omml\`; its unpacked Node module can be replaced without rebuilding or signing the application. Modified redistributions retain these terms and supply their corresponding source and installation information.

The formula palette embeds compact proper-set signs derived from the KaTeX 0.16.47 fonts, renamed DSH Set Relations under SIL OFL 1.1. The UI package includes their [font license](packages/client/ui-teacher-workbench/third-party/katex/OFL.txt) and [reproduction instructions](packages/client/ui-teacher-workbench/third-party/katex/NOTICE.txt).

The formula palette also embeds three glyphs derived from [STIX Two Math 2.13b171](https://github.com/stipub/stixfonts/tree/v2.13b171), distributed under SIL OFL 1.1. The DSH Math Symbols subset includes an upright complement with short inward terminals, compact slanted parallel lines, and a centered short negation stroke. The UI package ships the [font license](packages/client/ui-teacher-workbench/third-party/stix/OFL.txt) and [subset source and reproduction instructions](packages/client/ui-teacher-workbench/third-party/stix/NOTICE.txt).
`
}

/** Render third-party Skill resources distributed inside first-party packages. */
function renderBundledSkillDistributions(
  distribution: BundledSkillDistribution,
): string {
  return `
## Bundled skill distributions

[\`${distribution.name}\`](${distribution.repository}) ${distribution.version} is distributed inside \`@deepseek-ai/dsh-skill-ppt-master\` under the ${distribution.license} license. The complete ${distribution.fileCount.toLocaleString('en-US')}-file, ${distribution.byteCount.toLocaleString('en-US')}-byte upstream Skill directory preserves its \`LICENSE\`, sponsor records, dependency declaration, integrity guard, scripts, references, templates, images, and sounds. The package does not install the optional Python dependencies listed by the Skill; those remain operator-provided runtime components. The retained license is available at [\`${PPT_MASTER_ROOT}/LICENSE\`](${PPT_MASTER_ROOT}/LICENSE).
`
}

/** Render the installed and artifact-bundled Univer closure and its downstream obligation. */
function renderUniverCommercialDistribution(
  distribution: UniverCommercialDistribution | undefined,
): string {
  if (distribution === undefined) return ''
  const rows = distribution.packages.map(entry =>
    `| [\`${entry.name}\`](https://www.npmjs.com/package/${entry.name}) | ${entry.version} | ${entry.role} |`,
  )
  return `
## Univer installed and artifact-bundled closure

\`${UNIVER_OFFICE_PACKAGE}\` ${distribution.pluginVersion} is Apache-2.0, but its executable closure also contains the packages below. Its external \`@univerjs-pro/cli-assets\` dependency supplies the commercial resource catalog. Its build script inlines the listed \`@univerjs-pro/*\` and \`@univer-cli/*\` build-time modules into the shipped Host, Viewer, Gateway, worker, and render artifacts. Those modules retain their own terms; the wrapper's Apache-2.0 declaration does not relicense them, and the compiled tarball does not carry their individual package manifests or notices. [Univer's licensing guide](${UNIVER_COMMERCIAL_TERMS}) requires a valid Univer Pro commercial license for production use. Inclusion in this repository or an installer does not grant that license; every distributor and production operator must obtain all production and distribution rights required by Univer. A package identity, version, bundled-declaration digest, or platform-payload change requires another dependency, compatibility, terms, and notices review.

| Univer package | Version | Role |
| --- | --- | --- |
${rows.join('\n')}
`
}

/**
 * Render the complete notices document.
 * @returns The exact bytes THIRD_PARTY_NOTICES.md must hold after resolving browser inputs.
 */
export async function render(): Promise<string> {
  const browser = await browserBundledExternals(root)
  // The linked-manifest cache is keyed by name only, so it must not outlive
  // the manifests map it was resolved from; render() owns that single load.
  workspaceLinkedManifestCache.clear()
  const { manifests, names } = loadWorkspaceManifests()
  const npm = collectNpmDeps(manifests, names, browser)
  const runtimeDeps = npm.filter(dep => dep.runtime)
  const devDeps = npm.filter(dep => !dep.runtime)
  const kitRuntime = runtimeDeps.some(dep => dep.name === LIBREOFFICE_KIT_PACKAGE)
  const vendored = collectVendored()
  const pptMaster = collectPptMasterDistribution()
  const python = collectPython()
  const desktopPython = collectDesktopPythonDependencies({})
  const patched = collectPatched()
  const claudeDistribution = runtimeDeps.some(
    dep => dep.name === CLAUDE_AGENT_SDK_PACKAGE,
  )
    ? collectClaudeDistribution(manifests)
    : undefined
  const univerDistribution = runtimeDeps.some(
    dep => dep.name === UNIVER_OFFICE_PACKAGE,
  )
    ? collectUniverCommercialDistribution(manifests)
    : undefined
  const nonPermissiveDev = devDeps.filter(dep => !isPermissive(dep.license))
  assertRuntimeLicenses(runtimeDeps)
  assertRuntimeLicenses(desktopPython)
  const patchedLines = patched.map(({ spec, patch }) => `- \`${spec}\` — [\`${patch}\`](${patch})`)

  return `<!-- Generated by scripts/gen-third-party-notices.ts — do not edit by hand.
     Run \`pnpm run gen-third-party-notices\` to regenerate. -->

# Third-Party Notices

DeepSeek Harness is licensed under [MIT](LICENSE). It depends on the third-party software listed below. Each project remains under its own license; nothing in this file changes those terms.

This file lists **direct** dependencies declared by the workspace, packaged third-party Skill distributions, the explicitly disclosed official Claude Code platform payload closure, and the installed and artifact-bundled Univer closure. It is generated from the workspace manifests and pinned distribution resources by \`scripts/gen-third-party-notices.ts\`: a pre-commit hook regenerates it whenever a staged file changes one of its inputs, and \`scripts/gen-third-party-notices.spec.ts\` asserts in the test lane that the committed bytes match. Deleting a manifest runs no hook, so that case is caught by the assertion instead. Run \`pnpm run verify-third-party-notices\` for the standalone check.

The complete npm transitive closure, including the Landlock launcher workspace, is recorded with exact pinned versions in [\`pnpm-lock.yaml\`](pnpm-lock.yaml) — inspect it with \`pnpm licenses list\`. The Python SDK closure is recorded separately in [\`python/sdk/uv.lock\`](python/sdk/uv.lock).

## Vendored source (\`vendor/\`)

The Cordis framework and its foundation libraries are source-vendored into this repository rather than consumed from npm, and republished under the \`@deepseek-ai\` scope. All are MIT-licensed; each directory preserves its upstream \`LICENSE\` file. Exact upstream commits and local modifications are recorded in [\`vendor/README.md\`](vendor/README.md).

| Package | Upstream name | Source | License |
| --- | --- | --- | --- |
${vendored.map(row => `| \`${row.npmName}\` | \`${row.upstreamName}\` | [${row.sourceDirectory}](${row.sourceDirectory}/) | MIT |`).join('\n')}

${renderBundledSkillDistributions(pptMaster)}

## Runtime npm dependencies

External packages installed for runtime use or distributed inside the prebuilt browser artifacts. Browser inputs are resolved through the shipping tsdown and Vite configurations, independently of npm dependency sections. The tier covers every plugin a user can mount from \`cordis.yml\` — not only what the \`dsh\` CLI, Web UI, and Python SDK runtime load by default.

${renderNpmTable(runtimeDeps)}
${renderOfficeDistribution(runtimeDeps)}
${renderMathmlDistribution(runtimeDeps, manifests)}

pnpm applies local patches to the following packages at install time, so shipped artifacts carry modified copies; each patch file is the complete record of the modification:

${patchedLines.join('\n')}
${renderClaudeDistribution(claudeDistribution)}
${renderUniverCommercialDistribution(univerDistribution)}
${kitRuntime ? `
## LibreOffice conversion kit

${[...LIBREOFFICE_PACKAGES].map(name => `\`${name}\``).join(', ')} declare MPL-2.0, which remains outside the permissive-license allowlist; the notices check accepts only these package identities at those terms. The [distribution decision](.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.md) records the source obligations.

The [kit repository](https://github.com/deepseek-harness/libreoffice-kit) supplies the corresponding LibreOffice source pin, modifications, build instructions, Node API, and artifact validation. Its engine packages retain their license and third-party notices; the Node API retains its MPL-2.0 declaration and NOTICE. Recipients must have access to those corresponding sources and notices.
` : ''}

## Development-only npm dependencies

External packages **directly declared** for development, tests, types, or tooling, without a runtime installation or browser-build relationship. A package here may still be pulled in transitively by a runtime dependency — \`pnpm-lock.yaml\` is the authority on that full closure.

${renderNpmTable(devDeps)}
${renderNonPermissiveNote(nonPermissiveDev)}
## Python SDK dependencies (\`python/\`)

Direct dependencies of the \`pyproject.toml\` manifests, plus \`uv\` as the development workflow tool.

| Package | License | Role |
| --- | --- | --- |
${python.map(dep => `| [\`${dep.name}\`](${dep.repo}) | ${dep.license} | ${dep.role} |`).join('\n')}
| [\`uv\`](https://github.com/astral-sh/uv) | MIT / Apache-2.0 | development workflow tool |

## Desktop bundled Python distributions

The [Desktop runtime lock](apps/desktop/scripts/primary-runtime-lock.json) records each distribution version and the wheel download hashes. The table includes every entry in \`pythonPackages\`, including transitive dependencies. Wheel extraction preserves distribution metadata and the license and notice files supplied by each archive. Project licenses below do not enumerate the separate licenses of native libraries bundled inside wheels.

| Distribution | Locked version | Project license |
| --- | --- | --- |
${desktopPython.map(dep => `| [\`${dep.name}\`](${dep.repo}) | ${dep.version} | ${dep.license} |`).join('\n')}

## First-party native packages

\`@deepseek-ai/node-addon-system\` (and its platform packages) is built and released from this repository under BSD 3-Clause. It is listed here for completeness; it is first-party, not third-party.
`
}

/** CLI entry: default writes the notices, `--check` fails if the committed copy
 * is stale. Guarded behind an entry-point check so importing this module for
 * tests neither regenerates the committed file nor calls process.exit. */
async function main(): Promise<void> {
  const content = await render()
  if (process.argv.includes('--check')) {
    let committed: string | null = null
    try {
      committed = readFileSync(resolve(root, OUT), 'utf8')
    } catch {
      // Only ENOENT (not yet generated) is expected; a present-but-unreadable
      // file is not a state this repo produces, and the remedy is the same.
      committed = null
    }
    if (committed === content) {
      console.log(`gen-third-party-notices: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-third-party-notices: ${OUT} is stale. Run \`pnpm run gen-third-party-notices\` and commit ${OUT}.`)
    process.exit(1)
  }

  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-third-party-notices: wrote ${OUT}.`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
