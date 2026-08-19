@echo off
echo ========================================
echo   戴森球计划种子查看器 - 开发环境
echo ========================================
echo.
echo 启动后端服务...
start "种子查看器后端" cmd /c "cd backend && python main.py"

echo 等待后端启动...
timeout /t 2 /nobreak > nul

echo 启动前端服务...
start "种子查看器前端" cmd /c "npm run dev"

echo.
echo ========================================
echo   服务已启动
echo   前端: http://localhost:5173
echo   后端: http://localhost:8000
echo   API文档: http://localhost:8000/docs
echo ========================================
echo.
pause
