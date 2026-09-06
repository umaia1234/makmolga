# 작업 입력 예제

아래 좌표는 예시입니다. 실제 블록·밭·상자 위치를 관측한 다음 바꿔야 합니다. `minecraft_action`의 응답에서 `id`를 받아 `minecraft_job({id})`으로 완료와 결과를 확인합니다. 작업 실패·중단 후에는 실제 블록과 인벤토리를 다시 봅니다.

## 직접 제어

```json
{"action":{"type":"control","keys":["forward"],"milliseconds":300}}
```

`yaw`, `pitch`는 라디안입니다. `control`은 입력 유지 시간을 제한하며, 방향을 정확히 모르면 상태를 읽고 짧게 이동해 위치 변화를 확인합니다.

```json
{"action":{"type":"goto","position":{"x":10,"y":64,"z":5},"radius":1}}
```

## 농사

```json
{"action":{"type":"farm","positions":[{"x":10,"y":64,"z":5},{"x":11,"y":64,"z":5}]}}
```

각 좌표는 작물 블록의 위치입니다. 익지 않은 작물은 건너뛰며, 다시 심을 아이템이 없으면 수확 전에 실패합니다. 완료 후 인벤토리를 확인하고, 남아 있는 드롭은 안전한 밭 통로로 이동해 회수합니다.

## 창고 입출고와 분류

```json
{"action":{"type":"container","position":{"x":5,"y":64,"z":5},"direction":"inspect"}}
```

```json
{"action":{"type":"container","position":{"x":5,"y":64,"z":5},"direction":"deposit","item":"wheat","count":16}}
```

```json
{"action":{"type":"sort","rules":[{"position":{"x":5,"y":64,"z":5},"items":["wheat","wheat_seeds"]}],"keep":{"wheat_seeds":16,"bread":16}}}
```

`keep`를 직접 지정하면 그 객체가 기본 보존 목록을 대체합니다. 필요한 식량·씨앗의 예비량을 포함합니다. 공간 부족·수량 차이가 발생하면 이미 일부 이동했을 수 있으므로 재시도 전 확인합니다.

## 건축

```json
{"action":{"type":"build","blocks":[{"x":10,"y":64,"z":10,"block":"cobblestone"},{"x":11,"y":64,"z":10,"block":"cobblestone"},{"x":10,"y":65,"z":10,"block":"cobblestone"}]}}
```

배열 순서대로 시공합니다. 필요한 재료를 먼저 점검하고 이미 같은 블록이면 건너뜁니다. 다른 블록이 있으면 실패합니다. 봇 몸과 겹치는 위치나 지지 블록이 없는 곳에는 배치하지 않습니다. 계단·문 등의 정확한 방향은 지원하지 않습니다.

## 인챈트

슬롯은 현재 인벤토리 관측값을 사용합니다. 기대한 아이템 이름이 달라지면 작업을 거부합니다.

```json
{"action":{"type":"enchant","position":{"x":8,"y":64,"z":8},"slot":36,"expectedName":"diamond_pickaxe","choice":null}}
```

반환된 세 제안과 현재 경험치를 보고 선택합니다. 아래 `expectedEnchantmentId`는 실제 제안의 ID로 바꾸어야 합니다.

```json
{"action":{"type":"enchant","position":{"x":8,"y":64,"z":8},"slot":36,"expectedName":"diamond_pickaxe","choice":2,"maxLevelSpend":3,"expectedEnchantmentId":32}}
```

제안 미리보기는 창을 닫으며 재료를 되돌립니다. 미리보기 후 다른 행동으로 제안이 바뀔 수 있으므로 실행 시 다시 검사합니다. 선택에 따라 추가로 붙는 인챈트까지 보장하지 않습니다.

## CLI에서 JSON 파일 사용

위 예제를 예를 들어 `runtime/action.json`에 저장한 뒤 호출합니다. PowerShell에서 복잡한 JSON을 셸 문자열로 이스케이프하는 대신 파일을 사용하면 편합니다.

```powershell
npm run ctl -- action --file runtime/action.json
npm run ctl -- job 작업-ID
npm run ctl -- stop
```

현재 위치에 맞지 않는 예제는 바로 실행하지 않습니다. MCP 도구가 노출하는 Zod/JSON Schema가 전체 인자 목록의 기준입니다.
