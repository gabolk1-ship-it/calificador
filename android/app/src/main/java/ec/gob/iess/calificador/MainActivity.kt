package ec.gob.iess.calificador

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.nfc.tech.Ndef
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.*
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity(), NfcAdapter.ReaderCallback {

    private lateinit var webView: WebView
    private var nfcAdapter: NfcAdapter? = null

    // Solicitud de permisos en tiempo de ejecuci?n (C?mara)
    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        if (!isGranted) {
            Toast.makeText(this, "Permiso de c?mara necesario para escaneo ?ptico", Toast.LENGTH_LONG).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Configurar WebView en pantalla completa
        webView = WebView(this)
        setContentView(webView)

        setupWebView()
        setupNfc()
        checkPermissions()

        // Cargar el calificador desde Vercel
        val targetUrl = "https://calificador-v2.vercel.app"
        webView.loadUrl(targetUrl)

        // Procesar si se abri? mediante toque NFC
        intent?.let { handleNfcIntent(it) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.mediaPlaybackRequiresUserGesture = false

        // Bridge para comunicar JavaScript con Android Nativo
        webView.addJavascriptInterface(AndroidBridge(this), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                // Otorgar permiso de c?mara para el esc?ner web en tiempo real
                request?.grant(request.resources)
            }
        }
    }

    private fun setupNfc() {
        nfcAdapter = NfcAdapter.getDefaultAdapter(this)
    }

    private fun checkPermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onResume() {
        super.onResume()
        enableNfcReaderMode()
    }

    override fun onPause() {
        super.onPause()
        disableNfcReaderMode()
    }

    private fun enableNfcReaderMode() {
        nfcAdapter?.let { adapter ->
            if (adapter.isEnabled) {
                val flags = NfcAdapter.FLAG_READER_NFC_A or
                        NfcAdapter.FLAG_READER_NFC_B or
                        NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
                adapter.enableReaderMode(this, this, flags, null)
            }
        }
    }

    private fun disableNfcReaderMode() {
        nfcAdapter?.disableReaderMode(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNfcIntent(intent)
    }

    private fun handleNfcIntent(intent: Intent) {
        if (NfcAdapter.ACTION_TECH_DISCOVERED == intent.action ||
            NfcAdapter.ACTION_TAG_DISCOVERED == intent.action) {
            val tag: Tag? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
            }
            tag?.let { processNfcTag(it) }
        }
    }

    override fun onTagDiscovered(tag: Tag) {
        processNfcTag(tag)
    }

    private fun processNfcTag(tag: Tag) {
        vibratePhone(150)

        val tagIdHex = bytesToHex(tag.id)
        val techList = tag.techList.map { it.substringAfterLast(".") }

        val jsonResult = JSONObject()
        jsonResult.put("tipo", "NFC_DETECTADO")
        jsonResult.put("serialHex", tagIdHex)
        jsonResult.put("tecnologias", JSONObject.wrap(techList))

        // Si la tarjeta soporta IsoDep (SmartCard / C?dula Electr?nica ICAO 9303)
        val isoDep = IsoDep.get(tag)
        if (isoDep != null) {
            try {
                isoDep.connect()
                isoDep.timeout = 2000

                // Comando APDU SELECT e-Passport / e-ID MRTD Application
                // AID: A0 00 00 02 47 10 01
                val selectMrtdApdu = byteArrayOf(
                    0x00.toByte(), 0xA4.toByte(), 0x04.toByte(), 0x0C.toByte(),
                    0x07.toByte(),
                    0xA0.toByte(), 0x00.toByte(), 0x00.toByte(), 0x02.toByte(),
                    0x47.toByte(), 0x10.toByte(), 0x01.toByte()
                )

                val response = isoDep.transceive(selectMrtdApdu)
                val sw = bytesToHex(response.takeLast(2).toByteArray())

                jsonResult.put("esCedulaElectronica", sw == "9000" || sw.startsWith("61"))
                jsonResult.put("statusWord", sw)
                isoDep.close()
            } catch (e: Exception) {
                jsonResult.put("errorIsoDep", e.message)
            }
        }

        // Inyectar evento al frontend JavaScript
        runOnUiThread {
            val script = "if (window.onNativeNfcDiscovered) { window.onNativeNfcDiscovered(${jsonResult}); }"
            webView.evaluateJavascript(script, null)
        }
    }

    private fun vibratePhone(ms: Long) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(ms)
                }
            }
        } catch (_: Exception) {}
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder()
        for (b in bytes) {
            sb.append(String.format("%02X", b))
        }
        return sb.toString()
    }

    // Interfaz nativa disponible en window.AndroidBridge
    inner class AndroidBridge(private val context: Context) {
        @JavascriptInterface
        fun triggerHapticFeedback(ms: Long) {
            vibratePhone(ms)
        }

        @JavascriptInterface
        fun isNfcSupported(): Boolean {
            return nfcAdapter != null
        }

        @JavascriptInterface
        fun isNfcEnabled(): Boolean {
            return nfcAdapter?.isEnabled == true
        }

        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
