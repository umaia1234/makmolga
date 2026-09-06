# GitHub Actions 검증 템플릿

`verify.yml`은 Node 실행기와 Fabric 모드를 Linux에서 검증하는 설정입니다. **현재 자동 실행은 활성화하지 않았습니다.** 최초 업로드에 사용한 GitHub CLI 로그인에 `workflow` 권한이 없어 GitHub가 `.github/workflows/` 등록을 거절했습니다. 소스와 설치 파일은 정상적으로 올릴 수 있어 설정을 이 폴더에 보관했습니다.

활성화할 때는 해당 저장소를 관리하는 계정으로 다음을 실행해 추가 권한을 인증합니다.

```sh
gh auth refresh --hostname github.com --scopes workflow
```

그다음 저장소 루트에서 `docs/github-actions/verify.yml`을 `.github/workflows/verify.yml`로 복사하고 커밋·푸시합니다. 이후 `main`의 push, pull request, 수동 실행에서 검증합니다. 등록 뒤 **Actions** 탭에서 첫 실행 결과를 확인해야 원격 검증 완료입니다.

템플릿은 Node 24, JDK 25, 고정된 npm 의존성과 Gradle wrapper를 사용합니다. 런타임 검사에서는 ViaProxy를 내려받아 체크섬을 확인한 뒤 전체 테스트를 수행하고, Fabric 검사에서는 Java 테스트와 JAR 빌드를 수행합니다. 사용하는 GitHub Actions는 확인한 릴리스의 커밋 SHA에 고정했습니다.
