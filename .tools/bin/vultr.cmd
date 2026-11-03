@echo off
REM Project-scoped vultr-cli wrapper: always uses this project's config, never %USERPROFILE%\.vultr-cli.yaml
"%~dp0vultr-cli.exe" --config "%~dp0..\..\.vultr-cli.yaml" %*
