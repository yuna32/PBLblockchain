# demo/chain — 로컬 온체인 기록용 EAS 사전 빌드 파일

로컬 hardhat node에 EAS(Ethereum Attestation Service) 컨트랙트를 배포할 때 쓰는 빌드 결과물(ABI·bytecode)이다.
컴파일하지 않고 그대로 배포하며, `@ethereum-attestation-service/*` npm 패키지는 설치하지 않는다(viem으로 직접 호출).

| 파일 | 원본 경로 (패키지 안) | sha256 |
|---|---|---|
| `EAS.json` | `artifacts/contracts/EAS.sol/EAS.json` | `aebfeb36e77fdb614db769998fe5150275d220033ffe0e2fc5c973f1ce7d7bf3` |
| `SchemaRegistry.json` | `artifacts/contracts/SchemaRegistry.sol/SchemaRegistry.json` | `a41dafd6bf34f0ef3a01a93f34abfbe541ce2062a8e24489da1909f44fba3200` |
| `LICENSE` | `LICENSE` | `2737477c1d2dfa4ed0ee0e1f8e810d1d2fae0265a31ebdcd9c9eb6a3ce65b46f` |

- 출처 패키지: `@ethereum-attestation-service/eas-contracts@1.7.1` (npm, 저장소 https://github.com/ethereum-attestation-service/eas-contracts)
  - `@ethereum-attestation-service/eas-sdk@2.10.0`이 고정한 버전이다. 원본 컨트랙트는 solc 0.8.26으로 빌드되었다.
  - 받은 tarball의 integrity가 npm 레지스트리 값과 같은지 확인했다:
    `sha512-z2MeCrkp4JrtOMBHQt5fcdbxryC+xxofoPzzv3wcx5GbfG27PpkXRKxlSlb1l2jIT1YfDc701rixbP6vHaEN3Q==`
- 파일 내용은 원본 그대로이며 수정하지 않았다.

## 라이선스

위 파일들은 MIT 라이선스로 배포된다. 원문은 같은 디렉터리의 `LICENSE`에 있다.

> MIT License — Copyright (c) 2020 Leonid Beder
