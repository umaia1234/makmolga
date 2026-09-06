# MAKMOLGA 실행 안내

Mineflayer로 별도 플레이어 캐릭터를 실행하고, Codex 또는 다른 MCP 지원 LLM이 그 캐릭터를 제어하는 로컬 프로그램입니다. 대상은 **Java 26.2 정식 버전**입니다.

**현재 상태:** 실행기·15개 MCP 도구·Codex 채팅 브리지·사용 스킬과 **Fabric 26.2 캐릭터 선택창**을 구현했습니다. 실제 Mineflayer의 로컬 접속/이동/채팅과 26.2 프로토콜 변환 경로를 테스트했습니다. 서버와 봇 계정은 아직 설정하지 않았으며, 실제 26.2 월드의 생존·건축·농사·인챈트 검증은 남아 있습니다. 기존 실행기 증거는 [검증 기록](VALIDATION.md)에 있습니다.

## 캐릭터 선택창 설치

[설치용 ZIP](https://github.com/umaia1234/makmolga/releases/latest)의 모드 두 개를 Fabric 26.2 프로필의 `mods`에 넣습니다. 처음 월드에 들어가면 다섯 캐릭터의 3D 스킨과 성격 툴팁이 뜨며, 선택을 월드별로 저장합니다. **H 키** 또는 일시 정지 메뉴로 다시 열 수 있습니다. [설치·사용 안내](CHARACTER-SELECTOR.md), [캐릭터 기능 검증](CHARACTER-VALIDATION.md)을 참고해 주세요.

선택창의 **연결 설정**에서 이 폴더를 지정하면 선택한 성격을 기존 실행기에 전달합니다. 실제 LLM 대화에는 아래의 서버·계정·컨트롤러 설정이 필요합니다. 선택창 미리보기 스킨과 실제 봇 계정의 스킨은 별개입니다.

## 버전 호환 방식

```text
Mineflayer 4.38.0 (Java 26.1 / protocol 775)
          ↓
ViaProxy 3.4.12 (로컬 버전 변환)
          ↓
Minecraft Java 26.2 서버 (protocol 776)
```

Mineflayer 공식 지원 범위가 26.1까지라서 [26.2 지원 ViaProxy](https://github.com/ViaVersion/ViaProxy/releases/tag/v3.4.12)를 사용합니다. 서버 버전이나 기존 월드를 다운그레이드하지 않습니다. 26.2의 새 블록·아이템·엔티티가 26.1에서 표현 가능한 대상으로 바뀔 수 있어, 신규 콘텐츠 전체를 정확히 인식하는 네이티브 26.2 지원과는 차이가 있습니다. 향후 지원 여부는 `npm run doctor -- --online`으로 확인하고, 의존성 변경 후 테스트를 다시 실행합니다.

## 지금 실행하기

Node.js 22 이상과 JDK 25를 준비합니다. 의존성과 ViaProxy는 저장소에 포함하지 않으며, 아래 명령으로 설치하고 체크섬을 확인합니다.

```powershell
cd makmolga
npm ci
npm run setup -- --download-proxy
npm run doctor -- --online
npm start
```

기본 설정은 `autoConnect=false`, `controller.enabled=false`입니다. 실행하면 로컬 제어 API만 열리므로 서버와 계정 없이도 상태 조회가 됩니다. 다른 터미널에서:

```powershell
npm run ctl -- status
npm run ctl -- inbox
npm run ctl -- stop
```

Windows에서 숨김 백그라운드 실행은 `./Start-Companion.ps1 -Background`입니다. 단순히 터미널을 닫는 대신 백그라운드로 실행해야 유지됩니다. 전경 실행은 Ctrl+C로 종료합니다. `ctl stop`은 게임 동작을 중지하며 실행기 자체를 종료하지 않습니다. `ctl disconnect`는 게임 접속과 자동 재접속을 중지합니다. 실행기까지 종료하려면 `npm run ctl -- shutdown` 또는 `./Stop-Companion.ps1`을 실행합니다.

## 서버와 계정이 준비되면

`config.local.json`의 다음 항목을 수정합니다. 파일에는 모든 기본값이 들어 있습니다.

| 설정 | 넣을 값 |
|---|---|
| `minecraft.host`, `minecraft.port` | 접속할 서버 주소와 포트 |
| `minecraft.targetVersion` | `26.2` |
| `minecraft.clientVersion` | `26.1` |
| `minecraft.username` | 봇 캐릭터 이름/계정 식별자 |
| `owner.username`, `owner.uuid` | 사용자님의 게임 이름과 UUID |
| `owner.prefix` | 기본 `!봇 `, 빈 문자열이면 소유자의 모든 일반 채팅을 전달 |
| `safety.home` | 기지 좌표 `{ "x": 0, "y": 64, "z": 0 }` 또는 미설정 `null` |

멀티플레이에서는 사용자님과 봇이 각각 접속할 수 있는 계정이 필요합니다. 26.2 온라인 서버에 접속할 봇 계정은 ViaProxy GUI에서 로그인합니다.

```powershell
npm run setup -- --proxy-login
```

ViaProxy의 Accounts 탭에 **봇 계정**을 추가하고 GUI를 닫습니다. `proxy.accountIndex`는 첫 계정이면 `0`입니다. GUI가 프록시 포트를 점유한 채로 두지 않습니다. Microsoft 로그인/인증은 사용자가 직접 진행합니다. 그다음 실행기를 켜고:

```powershell
npm run ctl -- connect
npm run ctl -- status
```

`connection=connected`와 실제 위치를 확인합니다. `connect`가 반환한 `connecting`은 완료 상태가 아닙니다. UUID는 접속 후 `minecraft_observe`의 `visiblePlayers`에서 사용자 이름과 함께 확인할 수 있습니다. UUID가 비어 있으면 게임 채팅은 지시로 받아들이지 않습니다. 수정한 설정은 실행기를 다시 시작해야 적용됩니다.

온라인 서버의 인증 설정은 바꾸지 않습니다. 별도로 허용한 로컬 테스트/LAN 서버에만 `minecraft.auth=offline`, `allowOfflineLocal=true`, `proxy.authMethod=NONE`을 사용할 수 있습니다. 원격 서버의 오프라인 인증은 이 패키지 설정에서 차단합니다.

## Codex에서 직접 제어하기: MCP 모드

`npm run setup`이 현재 체크아웃 경로에 맞는 `docs/mcp-config.toml`과 `.codex/config.toml`을 로컬에 생성합니다. 두 파일은 Git에서 제외합니다. 기존 `.codex/config.toml`은 덮어쓰지 않습니다. [공식 MCP 설정 문서](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)에 따라 이 경로를 MCP 서버로 등록/활성화하고 도구 목록을 새로 로드합니다.

| 이름 | 역할 |
|---|---|
| `minecraft_status`, `minecraft_observe` | 체력·산소·인벤토리·주변 블록과 플레이어 조회 |
| `minecraft_connect`, `minecraft_disconnect` | 접속 및 접속 종료 |
| `minecraft_stop`, `minecraft_resume` | 작업 중지와 재개 |
| `minecraft_action`, `minecraft_job` | 작업 시작, 진행·결과 확인 |
| `minecraft_events`, `minecraft_inbox` | 이벤트 대기, 사용자 게임 메시지 조회 |
| `minecraft_acknowledge` | 처리한 메시지 완료 표시 |
| `minecraft_owner_message` | Codex의 실제 사용자 원문을 공통 메시지함에 기록 |
| `minecraft_chat` | 게임 채팅에 응답 |
| `minecraft_helpers`, `minecraft_select_helper` | 다섯 동료 조회, 월드별 동료 선택 |

MCP 모드에서는 **현재 Codex 대화에서 제가 직접 제어**할 수 있습니다. 게임 메시지는 `minecraft_events`/`minecraft_inbox`를 호출할 때 받아옵니다. MCP 자체가 종료된 Codex 턴을 자동으로 깨우거나 게임 채팅을 앱의 사용자 말풍선으로 삽입하지는 않습니다.

[플레이어 돕기 스킬](../skills/minecraft-companion/SKILL.md)을 함께 사용합니다. 스킬은 패키지 안에 작성했으며 전역 스킬 폴더에 자동 설치하지 않았습니다. 이 파일을 읽도록 지정하거나, 스킬 폴더 전체를 사용하는 환경의 스킬 검색 경로에 설치할 수 있습니다.

## 자동 LLM 컨트롤러와 두 채팅 공유

Codex App Server에 연결하는 컨트롤러를 구현했습니다. **게임 소유자 채팅과 해당 Codex 컨트롤러의 채팅을 현재 캐릭터의 같은 `threadId`에 사용자 입력으로 전달**합니다. 대화 ID는 캐릭터별 `controller.characterThreads`에 저장하여 말투와 대화 기록을 분리하고, 공통 메시지 기록과 월드 상태는 유지합니다. 사용 중인 일반 Desktop 대화와 자동 병합하는 기능은 아닙니다.

- 간단한 독립 실행: `controller.enabled=true`, `transport=stdio`. 첫 사용자 메시지에서 컨트롤러 대화를 만들고 ID를 `runtime/state.json`에 저장합니다. `npm run ctl -- chat "밭을 확인해 주세요"`와 게임의 `!봇 밭을 확인해 주세요`가 같은 대화를 사용합니다.
- Codex CLI 채팅까지 실시간 공유: `transport=websocket`으로 설정하고 `node scripts/codex-server.mjs`를 실행합니다. 별도 터미널에서 `codex --remote ws://127.0.0.1:4500`으로 **같은 App Server**에 접속한 후, 저장된 컨트롤러 대화 ID를 엽니다. 컨트롤러와 CLI가 같은 서버·대화를 사용해야 합니다.
- 모델 이름은 기본적으로 지정하지 않아 Codex 설정을 따릅니다. `controller.model`에 이름을 넣으면 그 이름을 그대로 요청합니다. 별도 OpenAI API 키를 요구하는 Responses API 앱은 아닙니다. Codex 로그인과 이용 한도를 사용합니다.

권한·승인·대화 재개·중복 처리와 한계는 [채팅 연결 설명](../skills/minecraft-companion/references/controller.md)에 있습니다. 자동 모드는 기본 꺼져 있고, 초기 전달물 이후 실제 Codex 연결 검증을 추가했습니다. 자율 계획과 이미지 기능의 현재 범위는 [자율 동료 안내](AUTONOMY.md)에 기록합니다.

## 가능한 작업

`minecraft_action`의 `action.type`은 아래 중 하나입니다. 각 동작은 작업 ID를 반환하며, `minecraft_job`에서 `completed`와 결과를 확인해야 완료입니다.

| 동작 | 범위 |
|---|---|
| `control` | 전진·후진·좌우·점프·달리기·웅크리기, 시선. 한 번에 최대 2초 |
| `goto`, `follow`, `return_home` | 좌표 이동, 최대 240초 추적, 설정한 기지로 이동 |
| `equip`, `eat` | 슬롯과 예상 이름을 확인한 장착, 일반 음식 섭취 |
| `dig`, `place`, `craft` | 예상 블록 확인 후 채굴, 단일 배치, 재료를 보유한 제작 |
| `build` | 바닥부터 정렬한 최대 128개 좌표·블록 목록. 기존 블록은 교체하지 않음 |
| `farm` | 최대 64개 밭 위치에서 성숙한 밀·당근·감자·비트 수확·재파종 |
| `container`, `sort` | 상자 조회·정량 입출고·품목별 분류. 도구/인챈트 물품 보존 |
| `enchant`, `anvil` | 인챈트 제안 확인/선택, 경험치 상한을 지정한 모루 결합 |
| `interact` | 블록/엔티티 상호작용, 탑승·하차·침대, 가까운 비플레이어 공격 |

현재 농사 작업은 지정 밭의 한 차례 수확·재파종입니다. 자동으로 밭을 발견·확장하거나 영구 반복하지 않습니다. 수확물은 일반 이동으로 회수하므로 인벤토리에서 확인해야 합니다. 특수 블록 방향·레드스톤·물 흐름까지 보장하는 설계도 엔진, PvP, 자유 탐험 AI, 경험치 농장 운영은 구현하지 않았습니다.

실행 예시는 [작업 예제](ACTIONS.md)를 참고하세요. 모든 구현 파일과 설정의 설명은 [구성요소 설명](../skills/minecraft-companion/references/architecture.md)에 있습니다.

## 지속 실행과 안전 동작

Node 프로세스가 살아 있는 동안 봇 접속, 진행 중 작업, 200ms 주기의 상태 확인이 유지됩니다. 물리 작업은 한 번에 하나이고 대화는 그동안 이어갈 수 있습니다. 경로 탐색은 자동 채굴·탑 쌓기·파쿠르를 끄고 위험 블록을 피합니다. 기본 `safety.protectiveStops=false`에서는 체력·산소·용암 상태를 관찰로 제공하고 대응은 LLM이 판단합니다. `true`로 켜면 저산소 자동 수영, 저체력 작업 중지, 임계 체력·용암 접속 종료를 사용합니다.

`runtime/state.json`에 메시지·최근 작업·이벤트·대화 ID를 저장합니다. 재시작 당시 실행 중이던 작업은 `interrupted`, 전달 여부가 불명확한 메시지는 `uncertain`으로 남깁니다. 월드를 확인하지 않고 자동 재실행하지 않습니다. 사용자 대화 전달 상한은 기본 `null`로 끄며 활성 턴은 300초로 제한합니다. 자율 모드에서는 별도 배경 호출 한도 안에서 관찰·대화·놀이를 이어가고 필요할 때 캐릭터·월드별 메모를 남깁니다.

`runtime/api-token`, Microsoft/ViaProxy 인증 캐시, `config.local.json`은 개인 로컬 파일입니다. 외부로 공유할 때 제외합니다. API와 프록시는 `127.0.0.1`에만 열립니다. 게임 채팅의 명령을 서버 관리 명령이나 OS 셸로 직접 실행하지 않습니다.

## 검증/참조

```powershell
npm run check
npm test
```

26.2 프로토콜 테스트는 검증한 ViaProxy JAR과 Java가 있어야 실행되며, JAR이 없으면 해당 테스트는 건너뜁니다. 결과와 미검증 항목은 [VALIDATION.md](VALIDATION.md)를 확인하세요.

원본 프로젝트/공식 문서: [Mineflayer](https://github.com/PrismarineJS/mineflayer), [Mineflayer API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md), [ViaProxy](https://github.com/ViaVersion/ViaProxy), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Codex App Server](https://learn.chatgpt.com/docs/app-server).
