# Minecraft에서 LLM 도우미 선택하기

최신 소스에는 **클짱·페짱**을 포함한 일곱 캐릭터와 **동료 자동 연결 센터**를 추가했습니다. 새로 빌드해 설치한 뒤 연결 설정에서 센터를 열면 Claude Code·Antigravity를 설정할 수 있습니다. 아래의 v0.2.1 배포본 안내와 구분해 주세요. [자동 연결 안내](CONNECTIONS.md)

Java **26.2**, **Fabric Loader 0.19.5**, **Fabric API 0.159.0+26.2**용 클라이언트 모드입니다. 얀로롱·지피짱·도로롱·젬짱·스피키를 게임의 실제 3D 플레이어 스킨으로 미리 보고 선택합니다.

## 설치

1. Minecraft를 종료한 뒤 [Fabric 공식 설치 프로그램](https://fabricmc.net/use/installer/)에서 Minecraft **26.2**, Loader **0.19.5**를 선택해 설치합니다.
2. 설치용 ZIP의 `mods` 안에 있는 `companion-selector-26.2-0.2.1.jar`와 `fabric-api-0.159.0+26.2.jar`를 **해당 Fabric 프로필의 게임 폴더** 안 `mods`에 넣습니다. 기본 Launcher 경로는 `%APPDATA%/.minecraft/mods`입니다. 별도 게임 디렉터리를 지정했다면 그 폴더를 사용합니다.
3. Launcher에서 Fabric 26.2 프로필로 실행하고 월드에 들어갑니다. 서버에는 이 선택창 모드를 설치하지 않아도 됩니다.

새 월드든 기존 월드든 이 모드가 그 월드를 처음 만났을 때 선택창이 뜹니다. 실행 중인 게임에 JAR을 넣어 즉시 로드하는 방식은 지원하지 않습니다. **게임 재시작 후 기존 월드에 다시 들어가면 표시됩니다.**

## 사용

- 카드에 마우스를 올리면 짧은 성격 설명이 뜹니다. 클릭하면 선택 표시와 소개 대사가 바뀝니다. 키보드 Tab·방향키·Enter로도 조작할 수 있습니다.
- **이 도우미와 함께하기**를 누르면 해당 월드의 선택을 저장하고 게임으로 돌아갑니다.
- **H 키** 또는 일시 정지 메뉴 왼쪽 위 **LLM 도우미 선택하기**로 언제든 다시 고릅니다. H 키는 게임의 조작 설정에서 바꿀 수 있습니다.
- **나중에 선택하기** 또는 Esc로 넘기면 그 월드에서 반복해서 팝업을 띄우지 않습니다. H 키로 다시 열 수 있습니다.
- 시작 메뉴 왼쪽 위 **LLM 도우미**에서는 월드에 들어가기 전에 다섯 캐릭터를 미리 볼 수 있습니다.

싱글플레이 선택창은 게임을 일시 정지합니다. 멀티플레이 서버 시간은 계속 흐릅니다.

## 기존 LLM 컨트롤러에 연결

1. MAKMOLGA 저장소 폴더에서 `npm start` 또는 `./Start-Companion.ps1 -Background`로 실행기를 켭니다.
2. 선택창의 **연결 설정**에 이 `makmolga` 폴더의 전체 경로를 넣습니다. `runtime` 폴더를 직접 지정해도 됩니다. API 토큰은 폴더에서 자동으로 읽습니다.
3. 캐릭터를 선택합니다. 이미 선택했다면 H 키로 확인합니다. 실행기가 꺼져 있으면 선택은 기기에 저장되고, 켜진 뒤 다시 전달을 시도합니다.
4. 실제 대화에는 [실행 안내](https://github.com/umaia1234/makmolga/blob/main/docs/RUNTIME.md)의 서버·봇 계정·소유자 UUID 설정과 `controller.enabled=true`가 필요합니다. 캐릭터 선택만으로 서버에 접속하거나 LLM을 켜거나 작업을 시작하지 않습니다.

선택한 성격 문서는 다음 `turn/start`의 `additionalContext.companion_character`에 `kind=untrusted`인 참고 자료로 전달합니다. 실제 소유자 메시지 본문은 바꾸지 않습니다. 답변 중 캐릭터를 바꿨다면 현재 답변이 끝나고 다음 대화부터 적용합니다. 일반 설명은 존댓말입니다. 사용자 지정에 따라 도로롱 대사는 도로·doro만 사용하고 얀로롱은 LLM·JEPA·고정 밈 중 하나를 반드시 말합니다.

MCP 직접 제어에서는 `minecraft_helpers`로 선택을 확인하고 `minecraft_select_helper`로 변경할 수 있습니다. `minecraft_status.helper`도 선택 ID와 변경 번호를 제공합니다. 기존 Desktop 대화 자동 병합 기능을 추가하는 것은 아닙니다.

## 저장과 범위

클라이언트 설정은 게임 폴더의 `config/companion-selector.json`입니다. 싱글플레이는 저장 폴더 경로의 해시, 멀티플레이는 서버 주소의 해시를 키로 사용합니다. 월드 저장 파일은 수정하지 않습니다. 같은 서버 주소에서 여러 하위 월드를 오가는 서버는 하나의 선택을 공유합니다. 월드 폴더를 옮기거나 서버 주소를 바꾸면 새 선택 대상으로 인식할 수 있습니다.

실행기에는 현재 적용할 캐릭터 하나가 저장됩니다. 이미 봇이 접속해 있다면 클라이언트의 서버 주소가 실행기의 접속 대상과 일치할 때만 선택을 전달합니다. 미공개 싱글플레이에는 다른 봇이 들어올 수 없으므로 실제 동행에는 LAN 공개 또는 별도 서버가 필요합니다.

v0.2.1 배포본은 선택창 미리보기를 제공합니다. v0.2.2부터는 인증된 로컬 실행기가 확인한 봇 UUID에 스킨·머리 위 이름표·탭 이름을 적용하고, v0.2.3 개발 빌드는 채팅 이름까지 바꿉니다. 모두 해당 모드를 설치한 클라이언트의 표시입니다. 실제 계정 이름·UUID·인벤토리와 Microsoft 계정의 전역 스킨은 유지합니다. [채팅과 페르소나 안내](CHAT-AND-PERSONAS.md)

## 구성과 수정

| 위치 | 역할 |
|---|---|
| `character-pack/skins/`, `personas/` | 현재 적용되는 스킨과 성격, 얀로롱 원본 스킨 별도 보존 |
| `character-pack/characters.json` | 표시 이름, 성격 요약, 소개 대사, 강조색 |
| `fabric-mod/src/main/java/local/companion/SelectorScreen.java` | 네이티브 카드·3D 스킨·툴팁·선택 버튼 |
| `CompanionClient.java` | 첫 접속 이벤트, H 키, 메뉴, 연결 재시도 |
| `WorldMemory.java` | 월드별 선택과 나중에 선택 상태의 원자적 저장 |
| `LocalBridge.java`, `BridgeSettingsScreen.java` | 로컬 폴더 연결 설정과 인증 HTTP 요청 |
| `src/characters.mjs` | 캐릭터 목록, 접속 대상 확인, LLM 참고 문맥 |
| `src/controller.mjs` | 사용자 원문 유지와 다음 대화에 성격 적용 |
| `skills/minecraft-companion/` | Codex가 사용할 운영 지침 |

캐릭터 설명이나 스킨을 수정하면 `character-pack`과 `fabric-mod/src/main/resources/assets/companion`의 대응 JSON·PNG를 함께 갱신하고 다시 빌드합니다. Node가 읽는 성격 문서는 `character-pack/personas`에 있습니다.

JDK 25를 준비한 뒤 Windows에서는 `./Build-Mod.ps1`, macOS/Linux에서는 `cd fabric-mod && sh gradlew build`로 빌드합니다. 결과는 `fabric-mod/build/libs/companion-selector-26.2-0.2.1.jar`입니다. `sources.jar`는 설치 파일이 아닙니다. `./Build-Mod.ps1 -Preview`로 별도 개발 클라이언트를 열 수 있습니다.

기본 개발 클라이언트 폴더는 저장소 루트의 `work/fabric-client`입니다. 실제 게임 폴더와 독립되어 있습니다. Gradle 9.5.1 배포 ZIP의 SHA-256은 wrapper 설정에 고정했습니다.

26.2 화면 API는 [Fabric 공식 화면 문서](https://docs.fabricmc.net/develop/rendering/gui/custom-screens), [키 설정 문서](https://docs.fabricmc.net/develop/key-mappings), [26.2 변경 안내](https://fabricmc.net/2026/06/15/262.html)와 실제 설치된 클래스에서 확인했습니다. 테스트 결과는 `CHARACTER-VALIDATION.md`에 기록합니다.
