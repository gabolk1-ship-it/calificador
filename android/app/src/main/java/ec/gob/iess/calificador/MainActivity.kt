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

        // 1. Si la tarjeta soporta IsoDep (SmartCard / Cédula Electrónica ICAO 9303)
        val isoDep = IsoDep.get(tag)
        if (isoDep != null) {
            try {
                isoDep.connect()
                isoDep.timeout = 2500

                // Paso A: SELECT e-Passport / e-ID MRTD Application (AID: A0 00 00 02 47 10 01)
                val selectMrtdApdu = byteArrayOf(
                    0x00.toByte(), 0xA4.toByte(), 0x04.toByte(), 0x0C.toByte(),
                    0x07.toByte(),
                    0xA0.toByte(), 0x00.toByte(), 0x00.toByte(), 0x02.toByte(),
                    0x47.toByte(), 0x10.toByte(), 0x01.toByte()
                )

                val response = isoDep.transceive(selectMrtdApdu)
                val sw = bytesToHex(response.takeLast(2).toByteArray())

                val isMrtd = sw == "9000" || sw.startsWith("61")
                jsonResult.put("esCedulaElectronica", isMrtd)
                jsonResult.put("statusWord", sw)

                if (isMrtd) {
                    // Paso B: Intentar seleccionar y leer EF.DG1 (contiene la MRZ con cédula y nombres)
                    // SELECT EF.DG1 (FID: 01 01)
                    val selectDg1 = byteArrayOf(
                        0x00.toByte(), 0xA4.toByte(), 0x02.toByte(), 0x0C.toByte(),
                        0x02.toByte(), 0x01.toByte(), 0x01.toByte()
                    )
                    val respDg1 = isoDep.transceive(selectDg1)
                    val swDg1 = bytesToHex(respDg1.takeLast(2).toByteArray())

                    if (swDg1 == "9000") {
                        // READ BINARY primer bloque de DG1 (hasta 255 bytes)
                        val readDg1 = byteArrayOf(
                            0x00.toByte(), 0xB0.toByte(), 0x00.toByte(), 0x00.toByte(), 0x00.toByte()
                        )
                        val dataDg1 = isoDep.transceive(readDg1)
                        val textDg1 = String(dataDg1, Charsets.ISO_8859_1)
                        val cedulaDg1 = extraerCedulaDeTexto(textDg1)
                        if (cedulaDg1 != null) {
                            jsonResult.put("cedula", cedulaDg1)
                        }
                    } else if (swDg1 == "6982") {
                        // Chip requiere autenticación criptográfica BAC / PACE previa
                        jsonResult.put("requiereDesbloqueoBAC", true)
                    }

                    // Paso C: Intentar leer EF.COM si aún no tenemos cédula
                    if (!jsonResult.has("cedula")) {
                        try {
                            val selectCom = byteArrayOf(
                                0x00.toByte(), 0xA4.toByte(), 0x02.toByte(), 0x0C.toByte(),
                                0x02.toByte(), 0x01.toByte(), 0x1E.toByte()
                            )
                            val respCom = isoDep.transceive(selectCom)
                            if (bytesToHex(respCom.takeLast(2).toByteArray()) == "9000") {
                                val readCom = byteArrayOf(0x00.toByte(), 0xB0.toByte(), 0x00.toByte(), 0x00.toByte(), 0x40.toByte())
                                val dataCom = isoDep.transceive(readCom)
                                val candCom = extraerCedulaDeTexto(String(dataCom, Charsets.ISO_8859_1))
                                if (candCom != null) jsonResult.put("cedula", candCom)
                            }
                        } catch (_: Exception) {}
                    }
                }

                isoDep.close()
            } catch (e: Exception) {
                jsonResult.put("errorIsoDep", e.message)
            }
        }

        // 2. Si la tarjeta soporta Ndef (etiquetas de texto o stickers con cédula)
        val ndef = Ndef.get(tag)
        if (ndef != null && !jsonResult.has("cedula")) {
            try {
                ndef.connect()
                val msg = ndef.ndefMessage
                if (msg != null) {
                    for (record in msg.records) {
                        val text = String(record.payload, Charsets.UTF_8)
                        val cand = extraerCedulaDeTexto(text)
                        if (cand != null) {
                            jsonResult.put("cedula", cand)
                            break
                        }
                    }
                }
                ndef.close()
            } catch (_: Exception) {}
        }

        // Inyectar evento al frontend JavaScript
        runOnUiThread {
            val script = "if (window.onNativeNfcDiscovered) { window.onNativeNfcDiscovered(${jsonResult}); }"
            webView.evaluateJavascript(script, null)
        }
    }

    private fun extraerCedulaDeTexto(texto: String): String? {
        // Buscar todas las secuencias numéricas de 10 dígitos
        val regex = Regex("\\b\\d{10}\\b")
        val matches = regex.findAll(texto)
        for (m in matches) {
            val cand = m.value
            if (esCedulaEcuatorianaValida(cand)) {
                return cand
            }
        }

        // Buscar patrón MRZ: ECU seguido de número
        val regexMrz = Regex("ECU([0-9]{10})")
        val matchMrz = regexMrz.find(texto)
        if (matchMrz != null) {
            val cand = matchMrz.groupValues[1]
            if (esCedulaEcuatorianaValida(cand)) return cand
        }

        // Buscar patrón de 9 dígitos y normalizar agregando el 0 inicial si provincia 01-09
        val regex9 = Regex("\\b\\d{9}\\b")
        val matches9 = regex9.findAll(texto)
        for (m in matches9) {
            val cand = "0" + m.value
            if (esCedulaEcuatorianaValida(cand)) {
                return cand
            }
        }

        return null
    }

    private fun esCedulaEcuatorianaValida(cedula: String): Boolean {
        if (cedula.length != 10) return false
        val prov = cedula.substring(0, 2).toIntOrNull() ?: return false
        if ((prov < 1 || prov > 24) && prov != 30) return false
        val d3 = cedula[2].digitToIntOrNull() ?: return false
        if (d3 >= 6) return false

        val coef = intArrayOf(2, 1, 2, 1, 2, 1, 2, 1, 2)
        var suma = 0
        for (i in 0 until 9) {
            var v = cedula[i].digitToInt() * coef[i]
            if (v >= 10) v -= 9
            suma += v
        }
        val digitoEsperado = if (suma % 10 == 0) 0 else 10 - (suma % 10)
        return digitoEsperado == cedula[9].digitToInt()
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
        fun getAppVersion(): String {
            return "1.3.0"
        }

        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
