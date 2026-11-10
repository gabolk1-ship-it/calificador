@echo off
title Calificador IESS / MSP - Servidor Local
color 0b
echo ========================================================
echo       CALIFICADOR DE DERECHO A SALUD (IESS / MSP)
echo ========================================================
echo.
echo Verificando servidor local en puerto 3080...

netstat -ano | findstr :3080 | findstr LISTENING >nul
if %errorlevel% == 0 (
    echo [OK] El servidor ya se encuentra en ejecucion en el puerto 3080.
) else (
    echo [INFO] Iniciando servidor Node.js...
    start /b  node server.js
 timeout /t 2 /nobreak >nul
)

echo.
echo [LISTO] Abriendo http://localhost:3080 en el navegador...
start http://localhost:3080
echo.
echo Puedes mantener esta ventana abierta o minimizarla.
pause
