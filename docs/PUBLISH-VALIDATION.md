# GitHub 배포 검증

최신 v0.2.1의 말투·스킨 변경과 재검증 결과는 [캐릭터 수정 기록](PERSONA-UPDATE.md)에 있습니다. 아래는 v0.2.0 최초 업로드 당시의 기록입니다.

2026-09-07, MAKMOLGA v0.2.0의 새 저장소 폴더에서 검증했습니다.

- 잠금 파일로 의존성을 새로 설치했습니다. `npm ci`의 보안 검사 결과는 알려진 취약점 0건입니다.
- 설치 스크립트로 ViaProxy 3.4.12를 내려받아 고정된 SHA-256과 비교했습니다.
- `npm run check`로 Node 모듈 29개를 검사했습니다.
- `npm test`에서 27개 테스트가 통과했고, 건너뛴 검사는 없습니다. 실제 로컬 Mineflayer 이동·채팅과 ViaProxy 프로토콜 변환 검사를 포함합니다.
- JDK 25와 Gradle wrapper 9.5.1로 `gradlew build`를 실행했습니다. Java 테스트 6개가 통과하고 모드 JAR을 생성했습니다.
- 개발 월드와 테스트 임시 파일은 새 저장소의 `work/`에 저장하도록 경로를 정리했습니다.

실제 게임 화면과 선택값 전달 검증은 [캐릭터 검증 기록](CHARACTER-VALIDATION.md)에 있습니다. 원래 실행기와 캐릭터 기능의 JSON 검증 기록은 해당 시점의 파일을 기준으로 남긴 이력입니다. 현재 릴리스 파일은 Releases의 `SHA256SUMS.txt`로 확인합니다.

[GitHub Actions 템플릿](github-actions/README.md)은 Linux에서 잠금 파일 설치, 구문 검사, 전체 Node 테스트, Fabric 빌드와 Java 테스트를 수행하도록 작성했습니다. 현재 로그인에 `workflow` 권한이 없어 자동 실행 등록과 원격 검증은 진행하지 않았습니다. 위 통과 결과는 로컬 검증 결과입니다. 실제 Minecraft UI의 운영체제별 확인이나 실제 계정·LLM을 사용한 장기 플레이도 이 자동 검사 범위에 포함되지 않습니다.
