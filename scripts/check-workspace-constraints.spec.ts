/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkProductionPeerClosure,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('application production peer closure', () => {
  const application: WorkspaceManifest = {
    dir: 'apps/application',
    manifest: {
      name: '@deepseek-ai/dsh-application',
      dependencies: { '@deepseek-ai/dsh-consumer': 'workspace:^' },
    },
  }
  const consumer: WorkspaceManifest = {
    dir: 'packages/core/consumer',
    manifest: {
      name: '@deepseek-ai/dsh-consumer',
      peerDependencies: { '@deepseek-ai/dsh-provider': 'workspace:^' },
    },
  }
  const provider: WorkspaceManifest = {
    dir: 'packages/core/provider',
    manifest: { name: '@deepseek-ai/dsh-provider' },
  }

  it('rejects a required peer outside the production graph', () => {
    expect(checkProductionPeerClosure(
      [application, consumer, provider], '@deepseek-ai/dsh-application',
    )).toEqual([
      '@deepseek-ai/dsh-application: production dependencies must include @deepseek-ai/dsh-provider, a required peer of @deepseek-ai/dsh-consumer',
    ])
  })

  it('accepts a required peer reached through another production dependency', () => {
    const complete = {
      ...application,
      manifest: {
        ...application.manifest,
        optionalDependencies: { '@deepseek-ai/dsh-provider': 'workspace:^' },
      },
    }
    expect(checkProductionPeerClosure(
      [complete, consumer, provider], '@deepseek-ai/dsh-application',
    )).toEqual([])
  })

  it('ignores optional peers', () => {
    const optional = {
      ...consumer,
      manifest: {
        ...consumer.manifest,
        peerDependenciesMeta: { '@deepseek-ai/dsh-provider': { optional: true } },
      },
    }
    expect(checkProductionPeerClosure(
      [application, optional, provider], '@deepseek-ai/dsh-application',
    )).toEqual([])
  })
})
