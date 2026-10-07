import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import React from 'react';
import ts from 'typescript';

// Extract and execute production TSX, retaining real React elements and onClick handlers.
// No provider, browser, restoration effect or alternate navigation implementation runs here.
async function productionAst(path) {
  const source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function descendants(ast) {
  const nodes = [];
  const walk = node => { nodes.push(node); ts.forEachChild(node, walk); };
  walk(ast);
  return nodes;
}
function evaluate(code, bindings) {
  const compiled = ts.transpileModule(`return (${code});`, {
    fileName: 'production-control.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('bindings', `with(bindings){${compiled}}`)(new Proxy(bindings, {
    has: () => true,
    get: (object, key) => key === Symbol.unscopables ? undefined : key in object ? object[key] : globalThis[key],
  }));
}
const wearAst = await productionAst('../src/pages/LightchainParityPages.tsx');
const labAst = await productionAst('../src/pages/LabPage.tsx');
const hookAst = await productionAst('../src/hooks/useCanonicalImageWorkspace.ts');
const hook = hookAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useCanonicalImageWorkspace');
assert.ok(hook?.body);
const continuationDeclarations = hook.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
const hookReturn = hook.body.statements.find(ts.isReturnStatement);
const continuation = hookReturn.expression.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(hookAst) === 'continueHref');
assert.ok(continuation, 'use the actual canonical continueHref expression');
function canonicalContinueHref(toolId, location) {
  const bindings = { toolId, location };
  for (const name of ['wearFamily', 'continueParams']) {
    const declaration = continuationDeclarations.find(node => node.name.getText(hookAst) === name);
    assert.ok(declaration);
    bindings[name] = evaluate(declaration.initializer.getText(hookAst), bindings);
  }
  const featureUpdate = hook.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(hookAst) === 'wearFamily');
  assert.ok(featureUpdate);
  evaluate(`() => { ${featureUpdate.getText(hookAst)} }`, bindings)();
  return evaluate(continuation.initializer.getText(hookAst), bindings);
}
const homes = [
  { name: 'Wear', ast: wearAst, component: 'LightchainOrientedDesignPage', toolId: 'wear-design-lab', path: '/flow/orientedDesign', testId: 'lightchain-wear-library-continue', newClass: 'oriented-design-new-card', constants: ['orientedDesignReferenceImages'] },
  { name: 'Lab', ast: labAst, component: 'LightchainLabBoardParity', toolId: 'lab', path: '/flow/laboratory', testId: 'lightchain-lab-library-continue', newClass: 'lightchain-lab-source-new-card cursor-pointer', constants: ['LIGHTCHAIN_LAB_REFERENCE_IMAGE'] },
];
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
function render(home, { search = '?libraryArtifactId=original-id&librarySlot=primary', hash = '#anchor', state = {} } = {}) {
  const location = { pathname: home.path, search, hash };
  const calls = [], hookCalls = [];
  const workspace = {
    jobId: null, pendingId: null, status: 'ready', error: null, originalInputsAvailable: true,
    slots: { primary: { sourceImageId: 'original-id' }, secondary: null }, result: null,
    toolId: home.toolId, continueHref: canonicalContinueHref(home.toolId, location), ...state,
  };
  const bindings = {
    React, ParityShell: 'parity-shell', MoreVertical: 'more-vertical',
    useLocation: () => location, useNavigate: () => href => calls.push(href),
    useCanonicalImageWorkspace: (...args) => { hookCalls.push(args); return workspace; },
    // The Wear board lists the user's saved projects; none are needed for the continuation control.
    useFeatureProjects: () => ({ projects: [], status: 'success' }),
    ProjectThumbnail: 'project-thumbnail', formatProjectAge: () => '今日',
  };
  const nodes = descendants(home.ast);
  for (const name of home.constants) {
    const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(home.ast) === name);
    assert.ok(declaration);
    bindings[name] = evaluate(declaration.initializer.getText(home.ast), bindings);
  }
  const component = home.ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === home.component);
  assert.ok(component);
  const tree = evaluate(component.getText(home.ast).replace(/^export\s+/, ''), bindings)();
  assert.equal(hookCalls.length, 1);
  assert.equal(hookCalls[0][0], home.toolId);
  const all = elements(tree);
  return { all, calls, workspace, control: all.find(element => element.props['data-testid'] === home.testId), newCard: all.find(element => element.props.className === home.newClass) };
}
function assertDestination(actual, expectedPath, expectedSearch, expectedHash) {
  const url = new URL(actual, 'https://fixture.test');
  assert.equal(url.pathname, expectedPath);
  assert.deepEqual([...url.searchParams].sort(), [...new URLSearchParams(expectedSearch)].sort());
  assert.equal(url.hash, expectedHash);
}
function clickNewCard(fixture, home) {
  assert.ok(fixture.newCard, 'ordinary new-card remains present');
  fixture.newCard.props.onClick();
  assert.equal(fixture.calls.at(-1), `${home.path}/detail`);
}

for (const home of homes) {
  test(`${home.name}: production Library control and handler preserve artifact, query, hash and feature`, () => {
    const search = '?libraryArtifactId=original-id&librarySlot=primary&context=keep%2Bme&tag=a&tag=b';
    const fixture = render(home, { search });
    assert.ok(fixture.control);
    assert.equal(fixture.control.type, 'button');
    assert.equal(fixture.control.props.type, 'button');
    assert.equal(fixture.control.props.children, 'Libraryの元画像で続ける');
    fixture.control.props.onClick();
    assert.deepEqual(fixture.calls, [fixture.workspace.continueHref]);
    const params = new URLSearchParams(search);
    if (home.name === 'Wear') params.set('workspaceFeature', 'wear-design-lab');
    assertDestination(fixture.calls[0], `${home.path}/detail`, params.toString(), '#anchor');
    assert.equal(fixture.workspace.slots.primary.sourceImageId, 'original-id');
    assert.equal(fixture.workspace.result, null, 'Library continuation does not require a generated result');
    assert.equal(fixture.all.indexOf(fixture.control) < fixture.all.indexOf(fixture.newCard), home.name === 'Wear', 'control stays adjacent to the existing continuation area');
    clickNewCard(fixture, home);
  });

  test(`${home.name}: encoded artifact identity and supplied continueHref are used exactly`, () => {
    const artifactId = 'original + /画像';
    const fixture = render(home, {
      search: `?libraryArtifactId=${encodeURIComponent(artifactId)}&librarySlot=primary`,
      state: { slots: { primary: { sourceImageId: artifactId } }, continueHref: `${home.path}/detail?libraryArtifactId=${encodeURIComponent(artifactId)}&retained=yes#exact` },
    });
    assert.ok(fixture.control);
    fixture.control.props.onClick();
    assert.deepEqual(fixture.calls, [fixture.workspace.continueHref], 'handler delegates to workspace.continueHref without rebuilding it');
  });

  const negatives = [
    ['missing artifact ID', { search: '?librarySlot=primary' }],
    ['empty artifact ID', { search: '?libraryArtifactId=&librarySlot=primary' }],
    ['loading', { state: { status: 'loading' } }],
    ['unavailable', { state: { status: 'unavailable' } }],
    ['error status', { state: { status: 'error' } }],
    ['ready with error', { state: { error: 'original_unavailable' } }],
    ['missing original inputs', { state: { originalInputsAvailable: false } }],
    ['mismatched original ID', { state: { slots: { primary: { sourceImageId: 'generated-result' } } } }],
    ['missing primary source', { state: { slots: { primary: null } } }],
    ['job precedence', { state: { jobId: 'job-original' } }],
    ['retained pending precedence', { state: { pendingId: 'pending-original' } }],
    ['unknown pending state', { state: { status: 'unknown', pendingId: 'pending-original' } }],
    ['saved generated state', { state: { status: 'saved' } }],
    ['error must be explicitly null', { state: { error: undefined } }],
  ];
  for (const [name, options] of negatives) test(`${home.name}: ${name} suppresses Library success control and retains new navigation`, () => {
    const fixture = render(home, options);
    assert.equal(fixture.control, undefined);
    assert.deepEqual(fixture.calls, []);
    clickNewCard(fixture, home);
  });

  test(`${home.name}: existing job continuation still uses workspace.continueHref`, () => {
    const fixture = render(home, { search: '?jobId=job-original&libraryArtifactId=original-id', state: { jobId: 'job-original', result: { jobId: 'job-original', imageUrl: 'fixture-result' }, status: 'saved' } });
    assert.equal(fixture.control, undefined);
    const jobControl = fixture.all.find(element => element.type === 'button' && element.props.children === '編集を続ける');
    assert.ok(jobControl);
    jobControl.props.onClick();
    assert.deepEqual(fixture.calls, [fixture.workspace.continueHref]);
    clickNewCard(fixture, home);
  });
}

test('Wear: actual mapped project and reference card handlers preserve every existing destination', () => {
  const fixture = render(homes[0]);
  const cards = fixture.all.filter(element => element.props.className === 'oriented-design-project-card');
  assert.equal(cards.length, 15);
  cards.forEach(card => card.props.onClick());
  assert.deepEqual(fixture.calls, [
    ...Array.from({ length: 13 }, (_, index) => `/flow/orientedDesign/detail?project=${index + 1}`),
    '/flow/orientedDesign/detail?reference=1', '/flow/orientedDesign/detail?reference=2',
  ]);
});

test('Lab: actual reference handler preserves board project destination', () => {
  const fixture = render(homes[1]);
  const reference = fixture.all.find(element => element.props['data-testid'] === 'lightchain-lab-reference-card');
  assert.ok(reference);
  reference.props.onClick();
  assert.deepEqual(fixture.calls, ['/flow/laboratory/detail?boardProjectCode=light-lab-reference']);
});
