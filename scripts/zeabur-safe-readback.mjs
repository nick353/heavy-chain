import { execFileSync } from 'node:child_process';

const cli = process.env.ZEABUR_CLI || '/usr/local/bin/zeabur';
const workspaceName = 'personal';
const projectName = 'automation-wiled';
const serviceName = 'heavy-chain';

function runJson(args) {
  try {
    const raw = execFileSync(cli, [...args, '-i=false', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(raw);
  } catch (error) {
    const code = error?.status ?? error?.code ?? 'unknown';
    throw new Error(`zeabur_readback_failed:${args.join(' ')}:${code}`);
  }
}

function safeService(service) {
  return {
    id: service?.ID ?? null,
    name: service?.Name ?? null,
    projectId: service?.Project?.ID ?? null,
    rootDirectory: service?.RootDirectory ?? null,
    template: service?.Template ?? null,
  };
}

function safeDeployment(deployment) {
  return {
    id: deployment?.ID ?? null,
    environmentId: deployment?.environmentID ?? null,
    status: deployment?.status ?? null,
    planType: deployment?.planType ?? null,
    gitProvider: deployment?.gitProvider ?? null,
    sourceMetadataPresent: Boolean(
      deployment?.repoOwner || deployment?.repoName || deployment?.ref || deployment?.commitSHA,
    ),
  };
}

function safeDomain(domain) {
  return {
    domain: domain?.domain ?? null,
    serviceId: domain?.serviceID ?? null,
    environmentId: domain?.environmentID ?? null,
    status: domain?.status ?? null,
  };
}

const auth = runJson(['auth', 'status']);
const projects = runJson(['project', 'list']);
const project = Array.isArray(projects) ? projects.find((item) => item?.Name === projectName) : null;

if (!project?.ID) {
  throw new Error(`zeabur_project_not_found:${projectName}`);
}

const services = runJson(['service', 'list', '--project-id', project.ID]);
const service = Array.isArray(services) ? services.find((item) => item?.Name === serviceName) : null;

if (!service?.ID) {
  throw new Error(`zeabur_service_not_found:${serviceName}`);
}

const deployments = runJson(['deployment', 'list', '--service-id', service.ID]);
const domains = runJson(['domain', 'list', '--id', service.ID]);
const latestDeployment = Array.isArray(deployments)
  ? [...deployments].sort((a, b) => String(b?.createdAt ?? '').localeCompare(String(a?.createdAt ?? '')))[0]
  : null;

const result = {
  schema: 'heavy-chain.zeabur-safe-readback.v1',
  authenticated: Boolean(auth),
  workspace: workspaceName,
  target: {
    project: { id: project.ID, name: project.Name },
    service: safeService(service),
  },
  latestDeployment: safeDeployment(latestDeployment),
  domains: Array.isArray(domains) ? domains.map(safeDomain) : [],
  securityBoundary: {
    variableReadbackCalled: false,
    secretValuesPrinted: false,
    reason: 'Zeabur CLI variable list is intentionally excluded because it can return unmasked secret values.',
  },
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
