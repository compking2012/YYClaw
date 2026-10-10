import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TitleBar } from '@/components/layout/TitleBar';
import { useSettingsStore } from '@/stores/settings';
import { toast } from 'sonner';
import { hostApi } from '@/lib/host-api';

declare global {
  interface Window {
    QRLogin: any;
  }
}

export function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation(['common']);
  const setLoggedIn = useSettingsStore((state) => state.setLoggedIn);
  const isLoggedIn = useSettingsStore((state) => state.isLoggedIn);

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/');
    }
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    let handleMessage: (event: MessageEvent) => void;
    
    const initFeishuSDK = async () => {
      try {
        const config = await hostApi.app.feishuConfig();
        if (!config || !config.appId) {
          toast.error(t('login.missingAppId'));
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://lf-package-cn.feishucdn.com/obj/feishu-static/lark/passport/qrcode/LarkSSOSDKWebQRCode-1.0.3.js';
        script.async = true;

        script.onload = () => {
          const redirectUri = 'http://localhost:17653/oauth/callback';
          const goto = `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${config.appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=RANDOMSTATE`;
          
          // Clear container before rendering to prevent multiple QR codes in React strict mode
          const container = document.getElementById("feishu_login_container");
          if (container) {
            container.innerHTML = '';
          }

          const QRLoginObj = window.QRLogin({
            id: "feishu_login_container",
            goto: goto,
            width: "300",
            height: "300",
            style: "width:300px;height:300px"
          });

          handleMessage = (event: MessageEvent) => {
            if (QRLoginObj.matchOrigin(event.origin) && QRLoginObj.matchData(event.data)) {
              const loginTmpCode = event.data.tmp_code;
              if (loginTmpCode) {
                const toastId = toast.loading(t('login.loggingIn'));

                const displayError = (errMsg: string) => {
                  if (errMsg.startsWith('AUTH_FAILED:')) {
                    toast.error(t('login.errors.AUTH_FAILED', { detail: errMsg.replace('AUTH_FAILED:', '').trim() }), { id: toastId });
                  } else if (errMsg.startsWith('TOKEN_FETCH_FAILED:')) {
                    toast.error(t('login.errors.TOKEN_FETCH_FAILED'), { id: toastId });
                  } else if (errMsg.startsWith('USER_INFO_FAILED:')) {
                    toast.error(t('login.errors.USER_INFO_FAILED'), { id: toastId });
                  } else if (errMsg === 'CONFIG_MISSING') {
                    toast.error(t('login.errors.CONFIG_MISSING'), { id: toastId });
                  } else if (errMsg === 'AUTH_CODE_MISSING') {
                    toast.error(t('login.errors.AUTH_CODE_MISSING'), { id: toastId });
                  } else {
                    toast.error(t('login.errors.UNKNOWN', { detail: errMsg }), { id: toastId });
                  }
                };

                hostApi.app.feishuLogin(loginTmpCode)
                  .then((res) => {
                    if (res.success) {
                      toast.success(t('login.success'), { id: toastId });
                      setLoggedIn(true, res.userInfo);
                      navigate('/');
                    } else {
                      displayError(res.error || '');
                    }
                  })
                  .catch((err: any) => {
                    displayError(err.message || String(err));
                  });
              }
            }
          };

          window.addEventListener('message', handleMessage);
        };

        document.body.appendChild(script);

        return script;
      } catch (err) {
        console.error('Failed to init Feishu SDK:', err);
      }
    };

    let scriptElement: HTMLScriptElement | undefined;
    initFeishuSDK().then((script) => {
      if (script) scriptElement = script;
    });

    return () => {
      if (handleMessage) {
        window.removeEventListener('message', handleMessage);
      }
      if (scriptElement && scriptElement.parentNode) {
        scriptElement.parentNode.removeChild(scriptElement);
      }
    };
  }, [navigate, setLoggedIn, t]);

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      <TitleBar />
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-3 tracking-tight">{t('login.welcome')}</h1>
          <p className="text-muted-foreground text-lg">{t('login.instruction')}</p>
        </div>
        <div className="bg-card p-6 rounded-2xl shadow-lg border border-border">
          <div id="feishu_login_container" className="flex items-center justify-center min-w-[300px] min-h-[300px] bg-white rounded-xl relative">
            {/* The container is emptied before the SDK injects the iframe, so we don't need a loading text span here as it would persist alongside the iframe */}
          </div>
        </div>
      </div>
    </div>
  );
}
