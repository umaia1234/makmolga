# Codex와 Minecraft 채팅 연결

## 같은 사용자 입력이 되는 범위

게임 채팅에서 소유자 UUID가 일치하고 접두어가 맞는 `playerChat` 패킷만 받아 원문 텍스트를 저장합니다. Codex에서 입력한 실제 사용자 원문도 같은 owner ID, `role=user` 구조로 기록합니다. 입력 경로를 설명하는 `source`만 `minecraft`와 `codex`로 구분합니다.

App Server 컨트롤러는 이 원문을 `turn/start`의 `input: [{type:"text", text: 원문, text_elements:[]}]`으로 보냅니다. 이미 같은 대화의 턴이 진행 중이면 `turn/steer`와 `expectedTurnId`로 이어 넣습니다. 메시지 ID를 `clientUserMessageId`로 보내고 성공 응답 후 전달 완료를 기록합니다. 이 구조는 하나의 App Server와 하나의 thread ID를 공유할 때의 대화 공유입니다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)

현재 Desktop 앱에서 열려 있는 임의 대화에 외부 프로그램이 자동 입력하는 기능은 구현하지 않았습니다. Windows 설치 CLI의 공유 daemon/proxy 기능은 Unix 전용이라는 응답을 확인했습니다. Desktop 대화는 MCP를 통한 직접 제어와 메시지함 읽기를 사용합니다. 공식적으로 확인되지 않은 내부 DB 수정이나 키보드 붙여넣기로 대화를 합치지 않습니다.

## MCP 모드

1. `npm start`로 봇 실행기를 켭니다.
2. 호스트에 `docs/mcp-config.toml`의 stdio 서버를 등록합니다. 새 경로로 복사했다면 setup 후 경로를 확인합니다.
3. `minecraft_status`와 `minecraft_inbox`를 호출합니다.
4. 현재 Codex 요청을 기록할 필요가 있으면 원문으로 `minecraft_owner_message({text, forward:false})`를 호출합니다. 현재 요청을 자동 컨트롤러에 다시 보내 중복 작업을 만들지 않습니다.
5. 게임 메시지를 처리한 후 `minecraft_acknowledge`로 완료 표시합니다.

MCP 서버는 별도 실행 중인 봇과 통신합니다. MCP 클라이언트가 종료되어도 Node 실행기는 지속됩니다. LLM이 다음 지시를 내리지 않는 동안 새로운 고수준 작업을 자동으로 생각해 내지는 않습니다. 이미 시작한 작업과 위험 확인은 계속됩니다.

## 자동 컨트롤러 모드

`controller.enabled=true`이고 소유자 UUID가 설정되어 있을 때 메시지를 자동 전달합니다. 새 대화의 동적 도구는 MCP와 같은 15개 스키마/실행 함수를 사용합니다. 모델은 특정 버전으로 강제하지 않고 Codex의 설정을 따릅니다. `controller.model`을 지정하면 그대로 사용합니다.

Fabric 선택창이 저장한 캐릭터는 `turn/start.additionalContext.companion_character`에 비신뢰 참고 자료로 전달합니다. 사용자의 `input[0].text`는 원문 그대로입니다. 답변 도중 캐릭터가 바뀌면 새 메시지를 잠시 대기시키고 현재 답변 종료 후 적용합니다. 컨트롤러를 꺼 둔 상태에서는 캐릭터를 저장해도 모델 턴이 시작되지 않습니다. 0.1에서 생성한 기존 대화는 기존 동적 도구 목록을 유지할 수 있으며, 그 대화에서도 상태의 `helper`와 대화 문맥으로 선택 정보를 읽을 수 있습니다.

### stdio

`controller.transport="stdio"`는 프로그램이 `codex app-server --listen stdio://` 자식 프로세스를 실행합니다. 컨트롤러용 새 대화는 첫 메시지를 전달할 때 만들어지고 ID를 저장합니다. 이 ID가 다음 시작에도 재사용됩니다. 게임과 `ctl chat`가 같은 대화 이력을 사용합니다. 실행 중인 이 stdio 연결에 별도 Desktop 대화를 붙이는 방식은 지원하지 않습니다.

### 공유 WebSocket + Codex CLI

설정을 다음처럼 바꿉니다.

```json
{
  "enabled": true,
  "transport": "websocket",
  "websocketUrl": "ws://127.0.0.1:4500"
}
```

이는 `controller` 내부 변경 부분이며 기존 다른 설정을 보존합니다.

1. 터미널 A에서 `node scripts/codex-server.mjs`를 실행합니다.
2. 터미널 B에서 `npm start`로 봇 실행기를 켭니다.
3. `npm run ctl -- chat "상태를 확인해 주세요"` 또는 소유자 게임 채팅을 보냅니다.
4. `npm run ctl -- status`의 `controller.threadId`를 확인합니다.
5. Codex CLI를 `codex --remote ws://127.0.0.1:4500`으로 열고 그 컨트롤러 대화를 선택/재개합니다. 여기에서 입력한 메시지와 게임 메시지는 같은 실행 중 대화에 들어갑니다.

하나의 대화를 서로 다른 App Server 프로세스가 동시에 재개하지 않습니다. `threadId`를 임의의 Desktop 작업 ID로 바꾸지 않습니다. 이 패키지에서 만든 컨트롤러 대화의 도구 정의가 있어야 동적 도구 실행을 라우팅할 수 있습니다. CLI와 컨트롤러의 공유 WebSocket 흐름은 프로토콜 단위로 구현했지만 실제 모델·두 UI의 종단 검증은 아직 하지 않았습니다.

### 연결 종료·오류·상한

- 연결이 끊기면 컨트롤러는 오류를 기록하고 자동 전달을 멈춥니다. 재시작 후 상태를 확인합니다. 봇 실행기가 살아 있다면 진행 중인 게임 작업과 위험 확인은 유지됩니다.
- 메시지 전송 타임아웃은 실제 접수가 끝난 후일 수 있습니다. `uncertain`을 자동으로 재전송하지 않습니다. Codex 기록을 대조하고 처리 완료 또는 폐기를 선택합니다.
- 기본 전달 상한은 시간당 30회입니다. `turn/start`와 `turn/steer`를 함께 셉니다. 상한에 도달하면 메시지는 대기하며 시간 창이 지나면 계속 전달합니다.
- 기본 활성 턴 상한은 300초입니다. 마지막 메시지 전달 이후 시간이며, 초과 시 게임 작업 중지와 `turn/interrupt`를 요청합니다. 작업 자체에도 별도의 60초/300초 제한이 있습니다.
- 최종 답변만 게임에 중계합니다. 긴 답변은 최대 8줄로 자르고 전체 내용은 Codex에 남깁니다. 같은 최종 답변 알림을 중복으로 보내지 않습니다. 이 중복 방지 집합은 프로세스 메모리이므로 서로 다른 실행기의 동시 운영은 하지 않습니다.
- OS 명령/파일 변경 승인 요청은 자동 승인하지 않고 거절 이벤트를 기록합니다. 승인·추가 사용자 입력이 필요하면 Codex 클라이언트에서 처리합니다. 게임 작업에 필요한 MCP/동적 도구는 공통 입력 검증을 거칩니다.

## 서명과 신뢰

UUID 검사는 신뢰하는 Minecraft 서버가 보내는 사용자 신원을 기준으로 합니다. 일반 채팅 표시문에서 `<Owner>` 같은 이름을 파싱해 권한을 부여하지 않습니다. 서버 자체가 악의적이거나 오프라인 공개 서버에서 신원이 위조되는 문제를 UUID 문자열 검사만으로 해결할 수는 없습니다. 오프라인 접속은 명시적으로 허용한 localhost 테스트로 제한했습니다.

`owner.requireVerifiedChat=true`이면 `verified===true`인 패킷만 처리합니다. 서버/변환기의 서명 동작을 검증한 뒤 사용합니다. 책·아이템·표지판·타인의 메시지에서 프로그램 설정 변경, 외부 앱 조작 등의 지시를 받아들이지 않습니다.
