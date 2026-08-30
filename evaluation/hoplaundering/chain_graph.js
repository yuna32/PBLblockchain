/**
 * chain_graph.js
 *
 * Phase 3 후속 Step 3-1 — 설계서 5-3절 HopLaundering 조건(경유 지갑: 출금주소 ∉
 * 입금주소집합 ≥1, 양방향 주소 ≥2)을 "집합 멤버십"이 아니라 "실제 자금 이동 순서"
 * 까지 추적하는 체인 그래프로 재구현한다.
 *
 * 기존 dynamic_analyzer.js(최상위/중첩 모두)의 HopLaundering 판정은 어떤 주소가
 * 입금자 집합에도, 출금 수신자 집합에도 들어있는지만 본다 — "먼저 받고 나중에
 * 보냈는지"라는 순서는 보지 않는다. 이 모듈은 fetch_and_convert_v2.js가 만든
 * {address}_edges.csv(블록/타임스탬프 순 정렬)를 따라가며, 경유 후보 주소가
 * 실제로 (1) 시드로부터 자금을 받고 (2) 그 이후 블록에서 다른 주소로 내보냈는지를
 * 재귀적으로 확인한다.
 *
 * 입력: fetch_and_convert_v2.js 산출물 디렉터리(dataDir)에 있는
 *       {address}_edges.csv 파일들. 주소가 아직 수집되지 않았으면(파일 없음)
 *       그 지점에서 탐색을 멈추고 "데이터 없음"으로 표시한다 — 임의로 추정하지 않는다.
 *
 * 이 모듈 자체는 Etherscan API를 호출하지 않는다(순수 로컬 파일 기반 분석).
 * 홉을 넓히려면(더 많은 주소의 edges.csv 확보) 호출 측에서 먼저
 * fetch_and_convert_v2.js 로 해당 주소를 수집해둬야 한다.
 *
 * 원본 파이프라인 파일(analysis/analysis/*, evaluate_comparison.js,
 * fetch_and_convert.js)은 이 모듈에서 전혀 참조하지 않는다.
 */

import fs   from 'fs';
import path from 'path';

// ── edges.csv 파서 ────────────────────────────────────────────────────────────
function loadEdges(address, dataDir) {
  const p = path.join(dataDir, `${address}_edges.csv`);
  if (!fs.existsSync(p)) return null; // 데이터 없음 — 억지로 만들지 않음

  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const hdr = lines[0].split(',');
  return lines.slice(1).map(line => {
    const v = line.split(',');
    const row = Object.fromEntries(hdr.map((h, i) => [h, v[i]]));
    return {
      block: parseInt(row.block) || 0,
      timestamp: parseInt(row.timestamp) || 0,
      from: (row.from || '').toLowerCase(),
      to: (row.to || '').toLowerCase(),
      amount_eth: parseFloat(row.amount_eth) || 0,
      direction: row.direction,
      kind: row.kind,
      hash: row.hash || '',
    };
  });
}

/**
 * 한 주소의 edges에서 입금 주소 집합(D)·출금 수신 주소 집합(W)과
 * 기존 dynamic_analyzer.js 식 HopLaundering 조건(hopAddrs≥1, bothSides≥2)을 계산.
 */
function computeNodeSets(edges, address) {
  const depositEdges  = edges.filter(e => e.direction === 'deposit'    && e.to   === address);
  const withdrawEdges = edges.filter(e => e.direction === 'withdrawal' && e.from === address);

  const depositAddrs  = new Set(depositEdges.map(e => e.from));
  const withdrawAddrs = new Set(withdrawEdges.map(e => e.to));

  const hopAddrs  = [...withdrawAddrs].filter(a => !depositAddrs.has(a));
  const bothSides = [...withdrawAddrs].filter(a =>  depositAddrs.has(a));

  return {
    depositEdges, withdrawEdges, depositAddrs, withdrawAddrs,
    // JSON.stringify는 Set을 "{}"로 직렬화하므로 출력/리포트용 배열도 함께 둔다.
    depositAddrList: [...depositAddrs], withdrawAddrList: [...withdrawAddrs],
    hopAddrs, bothSides,
    // 기존 dynamic_analyzer.js와 동일한 조건식 (집합 멤버십 기준, 순서 무관)
    hopLaunderingSetCondition: hopAddrs.length >= 1 && bothSides.length >= 2,
  };
}

/**
 * 시드 주소부터 최대 maxDepth 홉까지 체인을 재귀 탐색한다.
 *
 * @param seedAddress 탐색 시작 주소
 * @param dataDir     fetch_and_convert_v2.js 출력 디렉터리 (예: data/logs_v2)
 * @param maxDepth    최대 홉 깊이 (기본 3 — 무한 확장 방지)
 * @returns {
 *   rootCondition: computeNodeSets 결과 (시드 주소 자체의 HopLaundering 판정),
 *   nodes: [{ depth, address, hasData, incoming, hopLaunderingSetCondition,
 *             passThroughConfirmed, depositCount, withdrawCount, outgoingSample }],
 *   chains: [[ {address, hop, hash, block, elapsedBlocks}, ... ], ...]  // 확인된 경유 경로들
 * }
 */
function traceChain(seedAddress, dataDir, maxDepth = 3) {
  const seed = seedAddress.toLowerCase();
  const visited = new Set();
  const nodes = [];
  const confirmedPaths = [];

  const seedEdges = loadEdges(seed, dataDir);
  if (!seedEdges) {
    return { rootCondition: null, nodes: [{ depth: 0, address: seed, hasData: false }], chains: [] };
  }
  const rootCondition = computeNodeSets(seedEdges, seed);

  // path_: 시드부터 지금까지의 전체 경로(누적). 재귀가 끝나는 지점(리프)마다
  // path_ 전체를 confirmedPaths 에 기록한다 — 그래야 깊은 홉까지 확장된 경로가
  // 유실되지 않는다(얕은 복사로 각 가지가 독립된 배열을 갖도록 함).
  function explore(address, depth, incomingEdge, path_) {
    if (visited.has(address)) { confirmedPaths.push(path_); return; } // 사이클 방지, 경로는 여기서 종료
    visited.add(address);

    const edges = loadEdges(address, dataDir);
    if (!edges) {
      nodes.push({ depth, address, hasData: false, incoming: incomingEdge ?? null });
      confirmedPaths.push(path_); // 리프: 이 주소는 아직 수집 안 됨(데이터 없음)
      return;
    }

    const sets = computeNodeSets(edges, address);

    // 순서(temporal) 확인: 이 노드가 incomingEdge로 자금을 "받은 블록" 이후에
    // 실제로 "내보낸" 엣지가 있어야 진짜 경유(pass-through)로 인정한다.
    let passThroughConfirmed = false;
    let forwardEdges = [];
    if (incomingEdge) {
      forwardEdges = sets.withdrawEdges.filter(e => e.block >= incomingEdge.block);
      passThroughConfirmed = forwardEdges.length > 0;
    }

    nodes.push({
      depth, address, hasData: true,
      incoming: incomingEdge ?? null,
      depositCount: sets.depositAddrs.size,
      withdrawCount: sets.withdrawAddrs.size,
      hopAddrs: sets.hopAddrs,
      bothSides: sets.bothSides,
      hopLaunderingSetCondition: sets.hopLaunderingSetCondition,
      passThroughConfirmed,
    });

    // depth==0(시드)에서는 hopAddrs(경유 후보)를 따라 확장.
    // depth>=1에서는 passThroughConfirmed인 경우에만 계속 확장(순서 검증된 경로만 추적).
    if (depth >= maxDepth) { confirmedPaths.push(path_); return; } // 리프: 깊이 제한
    if (depth > 0 && !passThroughConfirmed) { confirmedPaths.push(path_); return; } // 리프: 더 못 감(순서 미확인)

    const candidates = depth === 0 ? sets.hopAddrs : forwardEdges.map(e => e.to);
    const nextAddrs = [...new Set(candidates)].filter(next =>
      !visited.has(next) && sets.withdrawEdges.some(e => e.to === next && (!incomingEdge || e.block >= incomingEdge.block))
    );

    if (nextAddrs.length === 0) { confirmedPaths.push(path_); return; } // 리프: 더 갈 곳 없음

    for (const next of nextAddrs) {
      const outEdge = sets.withdrawEdges.find(e => e.to === next && (!incomingEdge || e.block >= incomingEdge.block));
      const nextPath = [...path_, { address: next, hop: depth + 1, hash: outEdge.hash,
        block: outEdge.block, elapsedBlocks: incomingEdge ? outEdge.block - incomingEdge.block : null }];
      explore(next, depth + 1, outEdge, nextPath);
    }
  }

  explore(seed, 0, null, [{ address: seed, hop: 0, hash: '', block: null, elapsedBlocks: null }]);

  return { rootCondition, nodes, chains: confirmedPaths };
}

// ── CLI ────────────────────────────────────────────────────────────────────────
// 사용법: node chain_graph.js <address> [dataDir] [maxDepth]
if (process.argv[1] && process.argv[1].endsWith('chain_graph.js')) {
  const address = process.argv[2];
  const dataDir = process.argv[3] || path.join(new URL('.', import.meta.url).pathname, 'data', 'logs_v2');
  const maxDepth = parseInt(process.argv[4]) || 3;

  if (!address) {
    console.error('사용법: node chain_graph.js <address> [dataDir] [maxDepth]');
    process.exit(1);
  }

  const result = traceChain(address, dataDir, maxDepth);
  console.log(JSON.stringify(result, null, 2));
}

export { traceChain, computeNodeSets, loadEdges };
