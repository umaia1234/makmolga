# MAKMOLGA 설치부터 첫 대화까지

**Java 26.2 / v0.2.1 기준입니다.** 서버와 봇 계정이 없어도 1단계의 캐릭터 선택창은 사용할 수 있습니다. 실제 동료가 월드에 들어와 대화하고 작업하는 데에는 2–3단계가 필요합니다.

## 1. 모드 설치와 캐릭터 선택

1. Minecraft와 Launcher를 종료합니다. [Fabric 공식 설치기](https://fabricmc.net/use/installer/)에서 Windows 설치기를 받습니다.
2. 설치기를 실행하고 **Client → Minecraft 26.2 → Loader 0.19.5**를 선택해 설치합니다. 기존 Launcher의 게임 경로를 사용합니다.
3. [v0.2.1 릴리스](https://github.com/umaia1234/makmolga/releases/tag/v0.2.1)에서 **MAKMOLGA-26.2-v0.2.1.zip**을 내려받아 압축을 풉니다. GitHub가 제공하는 `Source code`는 이 설치 ZIP과 다릅니다.
4. ZIP의 `mods` 안에 있는 **companion-selector-26.2-0.2.1.jar**와 **fabric-api-0.159.0+26.2.jar**를 게임 폴더의 `mods`에 넣습니다. 기본 경로는 `%APPDATA%\.minecraft\mods`입니다. 별도 게임 디렉터리를 설정한 프로필이면 그 폴더의 `mods`를 사용합니다. 폴더가 없으면 만듭니다.
5. 0.2.0을 설치한 적이 있다면 기존 `companion-selector-26.2-0.2.0.jar`를 새 파일로 교체합니다. 같은 모드의 두 버전이나 Fabric API 중복 파일을 동시에 두지 않습니다.
6. Launcher에서 **fabric-loader-0.19.5-26.2** 프로필을 선택해 실행하고 새 월드 또는 기존 월드에 들어갑니다.
7. 선택창에서 캐릭터에 마우스를 올려 설명을 보고 **이 도우미와 함께하기**를 누릅니다. 이후에는 **H 키** 또는 일시 정지 메뉴 왼쪽 위 버튼으로 다시 선택합니다.

도로롱의 대사는 `도로! doro? DORO?!?!`처럼 도로 소리뿐입니다. 얀로롱은 눈을 밝게 수정했고 LLM·JEPA나 요청하신 밈을 매 대사에 포함합니다. 여기까지는 선택 화면이며, 아직 봇 플레이어가 월드에 접속한 상태는 아닙니다.

## 2. 동료 실행기 준비

Node.js 22 이상(권장 24)과 Java 25가 필요합니다. 소스 폴더가 이미 있다면 그 폴더를 사용합니다. 다른 PC에서는 저장소를 내려받습니다. 현재 저장소가 비공개이므로 `umaia1234` 계정 또는 접근 권한이 있는 계정으로 로그인해야 합니다.

```powershell
git clone https://github.com/umaia1234/makmolga.git
cd makmolga
npm ci
npm run setup -- --download-proxy
npm start
```

기본값은 서버 자동 접속과 LLM 컨트롤러가 꺼진 상태입니다. 이 터미널은 실행한 채 둡니다. 다른 터미널을 같은 폴더에서 열고 `npm run ctl -- status`를 실행해 API가 응답하는지 확인합니다.

게임 선택창의 **연결 설정**에 `makmolga` 폴더 전체 경로를 넣습니다. 캐릭터를 선택하면 실행기에 전달됩니다. 토큰을 따로 입력할 필요는 없습니다. `npm run ctl -- status`의 `helper.characterId`로 선택을 확인할 수 있습니다.

## 3. 실제 월드 동행과 LLM 대화

먼저 사용자님이 접속할 **Java 26.2 서버 또는 LAN 공개 월드**, 그리고 사용자님과 동시에 접속할 **별도의 봇용 Java 계정**을 준비합니다. 모드 자체가 서버나 계정을 생성하지 않습니다.

1. 실행기를 Ctrl+C로 종료하고 `config.local.json`의 `minecraft.host`, `minecraft.port`, `minecraft.username`에 서버 주소·포트·봇 게임 이름을 넣습니다. 26.2용 `targetVersion=26.2`, `clientVersion=26.1`, `proxy.enabled=true`는 유지합니다. LAN 월드는 공개할 때 표시된 포트를 사용합니다.
2. `npm run setup -- --proxy-login`을 실행하고 ViaProxy의 **Accounts**에서 봇 계정으로 Microsoft 로그인을 진행합니다. 첫 계정이면 `proxy.accountIndex=0`입니다. 로그인 후 ViaProxy 창을 닫습니다.
3. `npm start`로 실행기를 켜고 다른 터미널에서 아래를 실행합니다.

```powershell
npm run ctl -- connect
npm run ctl -- status
npm run ctl -- observe
```

`connection`이 **connected**이고 봇 위치가 있는지 확인합니다. `connecting`은 아직 완료가 아닙니다. 사용자님도 같은 월드의 가까운 위치에 있어야 `observe`의 `visiblePlayers`에서 이름과 UUID를 찾기 쉽습니다.

4. 실행기를 종료하고 `owner.username`, `owner.uuid`에 사용자님의 게임 이름과 UUID를 넣습니다. **봇의 UUID가 아닙니다.** 자동 LLM을 사용하려면 로컬 `codex` 명령이 실행되고 로그인되어 있어야 합니다. `codex --version`, `codex login status`로 확인할 수 있습니다.
5. `controller.enabled=true`, `controller.transport=stdio`로 바꾼 뒤 `npm start`와 `npm run ctl -- connect`를 다시 실행합니다. 설정 변경은 실행기 재시작 뒤 적용됩니다.
6. 게임에서 H 키로 동료를 고르고, 채팅창에 다음처럼 입력합니다.

```text
!봇 지금 상태를 확인해 주세요
!봇 저를 따라와 주세요
!봇 멈춰
```

로컬 터미널의 `npm run ctl -- chat "지금 상태를 확인해 주세요"`도 같은 컨트롤러 대화에 전달됩니다. 기존 Codex Desktop 대화와 자동 합쳐지는 기능은 아닙니다. 도로롱은 응답이 도로 소리뿐이므로 상세 작업 결과는 `status`, `events`, `job <작업 ID>`로 확인합니다.

## 켜 두기와 종료

- Windows 백그라운드 실행: `./Start-Companion.ps1 -Background`. PC가 켜져 있고 프로세스가 살아 있어야 유지됩니다.
- 작업만 중지: `npm run ctl -- stop` 또는 게임의 `!봇 멈춰`.
- 게임 접속 종료: `npm run ctl -- disconnect`.
- 실행기까지 종료: `npm run ctl -- shutdown` 또는 `./Stop-Companion.ps1`.

모드 업데이트는 Minecraft를 종료한 상태에서 JAR을 교체하고 다시 실행합니다. 기존 동료 선택은 유지됩니다. 실행기 업데이트도 재시작이 필요합니다. 현재 릴리스의 실제 서버·계정·LLM 장기 플레이 검증은 아직 남아 있으며, [전체 실행 안내](https://github.com/umaia1234/makmolga/blob/main/docs/RUNTIME.md)에 설정과 범위를 자세히 적었습니다.
