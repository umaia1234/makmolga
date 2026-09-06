# v0.2.1 — 도로롱 말투와 얀로롱의 눈·대사

2026-09-07 사용자 요청을 반영했습니다. 설치와 실행은 [처음 시작하기](../START-HERE.md)를 참고합니다.

## 도로롱

`도로`, `도로오오`, `도로!`, `도로?`, `doro?`, `doro!`, `DORO!`, `DORO?!?!`처럼 도로 소리만 사용합니다. 번역, 행동 지문, 다른 단어와 존댓말 어미를 붙이지 않습니다. 게임 선택창의 인사도 바꿨습니다.

성격 문맥과 컨트롤러 지침에 이 규칙을 전달하며 게임 채팅에서는 `src/voice.mjs`가 실제 전송 문구를 확인합니다. 규칙에 맞지 않는 문장이 나오면 `도로?`로 바꾸고, 원래 모델 문장은 실행기의 `controller_reply.modelText` 기록에 남깁니다. 사용자 입력, 도구 인자, 실제 작업 결과는 변환하지 않습니다. 도로롱의 소리는 작업 성공의 증거가 아니므로 상태와 작업 기록에서 결과를 확인합니다. Codex App Server의 원래 모델 출력 자체를 사후 편집하는 기능은 아닙니다.

## 얀로롱

매 대사에 **LLM·JEPA·제파** 또는 **이건...LLM이라고!!! / 비행기로 달 가기 ㄱㄴ** 중 하나가 들어갑니다. 맥락에 맞는 언급이 없으면 게임 채팅 앞에 `이건...LLM이라고!!!`를 붙입니다. 이 밈들은 사용자가 요청한 가상 캐릭터 대사이며 실제 인물의 검증된 인용이라고 표시하지 않습니다.

![왼쪽: 이전 눈, 오른쪽: 수정된 눈](images/yanro-eyes-before-after.png)

왼쪽이 이전 얼굴이고 오른쪽이 수정된 얼굴입니다. 눈을 두 픽셀 높이로 밝게 열고 부드러운 보라색을 적용했습니다. 눈 내부 `(9,13) (10,13) (13,13) (14,13) (9,14) (10,14) (13,14) (14,14)`의 **8픽셀만 변경**했습니다. 나머지 4,088픽셀의 RGBA 값과 64×64 크기, 안경의 위·옆 테두리, 머리·옷·UV 위치는 동일합니다. 원본은 `character-pack/skins/yanro_original_64x64.png`에 보존합니다.

- 원본 PNG SHA-256: `a95623d4b2b5cc413f9ad7ee8917a946e403abb0f98bbf1cd244ca14661ad26f`
- 수정 PNG SHA-256: `d4755c1464036c8b38069e14ffea62dda32bf7417c3fbbd9b9a86fc96b451945`
- 사용 방식: 내장 imagegen으로 눈 디자인을 수정한 뒤 생성된 눈의 색과 열린 형태를 기존 64×64 텍스처의 눈 안쪽에 맞춰 반영했습니다. 생성된 전체 아틀라스로 원본을 교체하지 않았습니다.
- 생성 프롬프트: “Edit only the front-face eyes of this Minecraft 64×64 Classic skin to be open, kind and cute, with white sclera and soft violet pupils/highlights. Keep black glasses, swept-back hair, pink cheeks, gray shirt, all other pixels and UV island positions. Return a transparent pixel-art skin atlas, no portrait, text or antialiasing.”

## 검증

Node 테스트 **31/31**, Java 테스트 **6/6**, Node 구문 검사 31개와 Fabric 26.2 모드 빌드가 통과했습니다. Minecraft 채팅 도구와 컨트롤러 답변 경로를 검사했으며, 캐릭터 변경 후 늦게 도착한 이전 답변도 원래 말투를 유지합니다. 스킨 두 복사본과 카탈로그 SHA-256의 일치, 8픽셀 외 RGBA 보존을 확인했습니다.

실제 Fabric 26.2 개발 클라이언트에서 수정된 얀로롱의 3D 눈, LLM·JEPA 설명과 두 대표 밈, 도로롱의 인사·툴팁을 확인했습니다. [얀로롱 선택 화면](images/character-selector-v021.png)과 [도로롱 선택 화면](images/doro-v021.png)은 게임에서 저장한 F2 스크린샷입니다. 이 확인은 별도 미리보기에서 진행했고 기존 게임 월드는 열지 않았습니다.

실제 LLM의 추론 응답과 실제 계정으로 장시간 함께 플레이하는 검증은 아직 남아 있습니다. 원본 0.2.0 검증 기록은 이력으로 보존하며 최신 설치 파일 체크섬은 Releases에서 확인합니다.
