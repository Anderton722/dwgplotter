"""Writes one page per DWG version code (ac1032 ... ac1015) in every language, plus pages/versions.sh (the make.sh page lines).
Also links those codes from the version table and the version checker. Run from the project root: py tools/make_versions.py"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ROOT / 'pages'
LANGS = ['en', 'es', 'fr', 'de', 'zh']
PRE = {'en': '', 'es': '/es', 'fr': '/fr', 'de': '/de', 'zh': '/zh'}

# code, format year, first release, last release (None = still current), the last release that cannot open it, previous code
CODES = [
    ('AC1032', '2018', '2018', None, '2017', 'AC1027'),
    ('AC1027', '2013', '2013', '2017', '2012', 'AC1024'),
    ('AC1024', '2010', '2010', '2012', '2009', 'AC1021'),
    ('AC1021', '2007', '2007', '2009', '2006', 'AC1018'),
    ('AC1018', '2004', '2004', '2006', '2002', 'AC1015'),
    ('AC1015', '2000', '2000', '2002', 'R14', 'AC1014'),
]
SAVE_YEAR = {'AC1032': '2018', 'AC1027': '2013/LT2013', 'AC1024': '2010/LT2010', 'AC1021': '2007/LT2007',
             'AC1018': '2004/LT2004', 'AC1015': '2000/LT2000'}

T = {
'en': dict(
    title='{code} DWG: Which AutoCAD Version Is It?',
    desc='{code} is the AutoCAD {fmt} DWG format, saved by AutoCAD {saved}. Which programs open it, how to save in it, and how to view it free.',
    range='{a} to {b}', current='{a} to the current release', r2000='2000, 2000i and 2002', save='AutoCAD {y} Drawing (*.dwg)',
    h1='{code}: the AutoCAD <span class="grad">{fmt} DWG format</span>',
    lead='{code} is the version code of the AutoCAD {fmt} DWG format. A drawing that starts with {code} was saved by AutoCAD {saved}, or by another CAD program set to that format. {note}',
    cta1='Open an {code} file free', cta2="Check a file's version",
    glance='{code} at a glance', r_code='Version code', r_name='Format name', v_name='AutoCAD {fmt} drawing', r_saved='Saved by',
    r_opens='Opens in', v_opens='AutoCAD {fmt} and later', r_here='Opens in DWG Plotter', v_here='Yes, free in your browser',
    h_soft='Which software opens an {code} file',
    p_soft='Every AutoCAD and AutoCAD LT release from {fmt} onwards opens it, as do most other CAD programs that read DWG. AutoCAD {older} and older cannot open it and show an error instead.',
    p_view='Without AutoCAD, drop the file into the <a href="{pre}/dwg-viewer/">free DWG viewer</a>: you can see every layout, zoom, measure and save it as a PDF. The file is read on your computer and never uploaded.',
    h_older='Opening it in an older AutoCAD',
    p_older='Ask whoever sent the file to save a copy in an older format: Save As, then pick the “AutoCAD 20xx Drawing” file type that matches your release, such as “{prevsave}”. If you only need to look at or print the drawing, <a href="{pre}/dwg-to-pdf/">converting it to PDF</a> is quicker.',
    h_2000='Why programs ask for AC1015',
    p_2000='Almost every program that imports DWG or DXF, including older CNC, CAM and GIS software, can read the 2000 format. That is why export settings and file requests often say “AutoCAD 2000 DWG”. Only Release 14 and older cannot open it.',
    h_save='Saving a drawing as {code}',
    p_save='In AutoCAD {fmt} or later, choose Save As and set the file type to “{save}”. To make it the default, change it under Options, Open and Save. Saving in an older format can simplify objects that format does not support, so keep the original too.',
    save_current='It is already the default in every current release.',
    h_q='Questions',
    q1='Which AutoCAD version is {code}?', a1='It is the AutoCAD {fmt} DWG format, used by AutoCAD {saved}.',
    q2='Can AutoCAD {older} open an {code} file?', a2='No. AutoCAD {older} reads only up to {prev}. Save the drawing as “{prevsave}”, or view it in a browser instead.',
    a2_2000='No. Release 14 reads only up to AC1014. View the drawing in a browser instead, or convert it to PDF.',
    q3='How do I check whether my file is {code}?', a3='Drop it into the <a href="{pre}/dwg-version-checker/">DWG version checker</a>, or open it in a plain text editor: the first six characters are the version code.',
    q4='Do DXF files use the same {code} code?', a4='Yes. A DXF file stores the same code after $ACADVER near the top, so a DXF marked {code} is in the {fmt} format.',
    h_other='Other DWG versions', all='All versions in one table',
    notes={
        'AC1032': 'It is the longest-lived DWG format so far: every release since 2018 still saves in it, so most drawings made today are AC1032.',
        'AC1027': 'Five releases used it, so it is one of the most common versions in drawing archives.',
        'AC1024': 'AutoCAD 2010, the first release to save it, also introduced parametric constraints and mesh modelling.',
        'AC1021': 'It was the first DWG format to store text as Unicode, so drawings in any alphabet keep their characters.',
        'AC1018': 'AutoCAD 2004, the first release to save it, introduced true colour and colour books.',
        'AC1015': 'AutoCAD 2000, the first release to save it, introduced multiple layouts and lineweights, which plotting still depends on.'}),
'es': dict(
    title='{code}: ¿qué versión de AutoCAD es este DWG?',
    desc='{code} es el formato DWG de AutoCAD {fmt}, que usa AutoCAD {saved}. Qué programas lo abren, cómo guardar en él y cómo verlo gratis.',
    range='{a} a {b}', current='{a} hasta la versión actual', r2000='2000, 2000i y 2002', save='Dibujo de AutoCAD {y} (*.dwg)',
    h1='{code}: el formato DWG de <span class="grad">AutoCAD {fmt}</span>',
    lead='{code} es el código de versión del formato DWG de AutoCAD {fmt}. Un dibujo que empieza por {code} se guardó con AutoCAD {saved}, o con otro programa CAD configurado en ese formato. {note}',
    cta1='Abrir un archivo {code} gratis', cta2='Comprobar la versión de un archivo',
    glance='{code} en resumen', r_code='Código de versión', r_name='Nombre del formato', v_name='Dibujo de AutoCAD {fmt}', r_saved='Lo guarda',
    r_opens='Se abre en', v_opens='AutoCAD {fmt} y posteriores', r_here='Se abre en DWG Plotter', v_here='Sí, gratis en tu navegador',
    h_soft='Qué programas abren un archivo {code}',
    p_soft='Lo abren todas las versiones de AutoCAD y AutoCAD LT desde la {fmt}, y la mayoría de los demás programas CAD que leen DWG. AutoCAD {older} y anteriores no pueden abrirlo y muestran un error.',
    p_view='Sin AutoCAD, suelta el archivo en el <a href="{pre}/dwg-viewer/">visor DWG gratuito</a>: verás cada presentación y podrás hacer zoom, medir y guardarlo en PDF. El archivo se lee en tu ordenador y nunca se sube.',
    h_older='Abrirlo en un AutoCAD anterior',
    p_older='Pide a quien te envió el archivo que guarde una copia en un formato anterior: Guardar como y elegir el tipo «Dibujo de AutoCAD 20xx» que corresponda a tu versión, por ejemplo «{prevsave}». Si solo necesitas verlo o imprimirlo, <a href="{pre}/dwg-to-pdf/">convertirlo a PDF</a> es más rápido.',
    h_2000='Por qué los programas piden AC1015',
    p_2000='Casi todos los programas que importan DWG o DXF, incluido el software CNC, CAM y SIG más antiguo, leen el formato 2000. Por eso las opciones de exportación y las peticiones de archivos suelen decir «DWG de AutoCAD 2000». Solo la Release 14 y anteriores no pueden abrirlo.',
    h_save='Guardar un dibujo como {code}',
    p_save='En AutoCAD {fmt} o posterior, elige Guardar como y el tipo de archivo «{save}». Para que sea el predeterminado, cámbialo en Opciones, Abrir y guardar. Guardar en un formato anterior puede simplificar objetos que ese formato no admite, así que conserva también el original.',
    save_current='Ya es el formato predeterminado en todas las versiones actuales.',
    h_q='Preguntas',
    q1='¿Qué versión de AutoCAD es {code}?', a1='Es el formato DWG de AutoCAD {fmt}, que usa AutoCAD {saved}.',
    q2='¿Puede AutoCAD {older} abrir un archivo {code}?', a2='No. AutoCAD {older} solo lee hasta {prev}. Guarda el dibujo como «{prevsave}» o visualízalo en el navegador.',
    a2_2000='No. La Release 14 solo lee hasta AC1014. Visualiza el dibujo en el navegador o conviértelo a PDF.',
    q3='¿Cómo sé si mi archivo es {code}?', a3='Suéltalo en el <a href="{pre}/dwg-version-checker/">comprobador de versión DWG</a>, o ábrelo en un editor de texto: los seis primeros caracteres son el código de versión.',
    q4='¿Los archivos DXF usan el mismo código {code}?', a4='Sí. Un DXF guarda el mismo código después de $ACADVER, cerca del principio, así que un DXF marcado {code} está en formato {fmt}.',
    h_other='Otras versiones de DWG', all='Todas las versiones en una tabla',
    notes={
        'AC1032': 'Es el formato DWG más duradero hasta ahora: todas las versiones desde 2018 siguen guardando en él, así que la mayoría de los dibujos actuales son AC1032.',
        'AC1027': 'Lo usaron cinco versiones, así que es uno de los más comunes en los archivos de dibujos.',
        'AC1024': 'AutoCAD 2010, la primera versión que lo guardó, también introdujo las restricciones paramétricas y el modelado de mallas.',
        'AC1021': 'Fue el primer formato DWG que guarda el texto en Unicode, así que los dibujos en cualquier alfabeto conservan sus caracteres.',
        'AC1018': 'AutoCAD 2004, la primera versión que lo guardó, introdujo el color verdadero y los libros de colores.',
        'AC1015': 'AutoCAD 2000, la primera versión que lo guardó, introdujo las presentaciones múltiples y los grosores de línea, de los que aún depende el trazado.'}),
'fr': dict(
    title="{code} : quelle version d'AutoCAD pour ce DWG ?",
    desc="{code} est le format DWG d'AutoCAD {fmt}, utilisé par AutoCAD {saved}. Logiciels qui l'ouvrent et comment le voir gratuitement.",
    range='{a} à {b}', current="{a} jusqu'à la version actuelle", r2000='2000, 2000i et 2002', save='Dessin AutoCAD {y} (*.dwg)',
    h1="{code} : le format DWG d'<span class=\"grad\">AutoCAD {fmt}</span>",
    lead="{code} est le code de version du format DWG d'AutoCAD {fmt}. Un dessin qui commence par {code} a été enregistré par AutoCAD {saved}, ou par un autre logiciel de CAO réglé sur ce format. {note}",
    cta1='Ouvrir un fichier {code} gratuitement', cta2="Vérifier la version d'un fichier",
    glance='{code} en bref', r_code='Code de version', r_name='Nom du format', v_name='Dessin AutoCAD {fmt}', r_saved='Enregistré par',
    r_opens="S'ouvre dans", v_opens='AutoCAD {fmt} et suivants', r_here="S'ouvre dans DWG Plotter", v_here='Oui, gratuitement dans votre navigateur',
    h_soft='Quels logiciels ouvrent un fichier {code}',
    p_soft="Toutes les versions d'AutoCAD et d'AutoCAD LT depuis la {fmt} l'ouvrent, ainsi que la plupart des autres logiciels de CAO qui lisent le DWG. AutoCAD {older} et les versions antérieures ne peuvent pas l'ouvrir et affichent une erreur.",
    p_view="Sans AutoCAD, déposez le fichier dans la <a href=\"{pre}/dwg-viewer/\">visionneuse DWG gratuite</a> : vous voyez chaque présentation, vous pouvez zoomer, mesurer et l'enregistrer en PDF. Le fichier est lu sur votre ordinateur et n'est jamais envoyé.",
    h_older="L'ouvrir dans un AutoCAD plus ancien",
    p_older="Demandez à l'expéditeur d'enregistrer une copie dans un format plus ancien : Enregistrer sous, puis le type « Dessin AutoCAD 20xx » adapté à votre version, par exemple « {prevsave} ». Si vous devez seulement consulter ou imprimer le dessin, <a href=\"{pre}/dwg-to-pdf/\">le convertir en PDF</a> est plus rapide.",
    h_2000='Pourquoi les logiciels demandent AC1015',
    p_2000="Presque tous les logiciels qui importent du DWG ou du DXF, y compris les anciens logiciels de CN, de FAO et de SIG, lisent le format 2000. C'est pourquoi les options d'export et les demandes de fichiers indiquent souvent « DWG AutoCAD 2000 ». Seules la Release 14 et les versions antérieures ne peuvent pas l'ouvrir.",
    h_save='Enregistrer un dessin en {code}',
    p_save="Dans AutoCAD {fmt} ou ultérieur, choisissez Enregistrer sous et le type de fichier « {save} ». Pour en faire le format par défaut, modifiez-le dans Options, Ouvrir et enregistrer. Enregistrer dans un format plus ancien peut simplifier des objets que ce format ne gère pas : gardez aussi l'original.",
    save_current="C'est déjà le format par défaut de toutes les versions actuelles.",
    h_q='Questions',
    q1="Quelle version d'AutoCAD correspond à {code} ?", a1="C'est le format DWG d'AutoCAD {fmt}, utilisé par AutoCAD {saved}.",
    q2='AutoCAD {older} peut-il ouvrir un fichier {code} ?', a2="Non. AutoCAD {older} ne lit que jusqu'à {prev}. Enregistrez le dessin en « {prevsave} » ou affichez-le dans un navigateur.",
    a2_2000="Non. La Release 14 ne lit que jusqu'à AC1014. Affichez le dessin dans un navigateur ou convertissez-le en PDF.",
    q3='Comment savoir si mon fichier est en {code} ?', a3='Déposez-le dans le <a href="{pre}/dwg-version-checker/">vérificateur de version DWG</a>, ou ouvrez-le dans un éditeur de texte : les six premiers caractères sont le code de version.',
    q4='Les fichiers DXF utilisent-ils le même code {code} ?', a4='Oui. Un DXF enregistre le même code après $ACADVER, près du début : un DXF marqué {code} est au format {fmt}.',
    h_other='Autres versions DWG', all='Toutes les versions dans un tableau',
    notes={
        'AC1032': "C'est le format DWG le plus durable à ce jour : toutes les versions depuis 2018 l'utilisent encore, donc la plupart des dessins actuels sont en AC1032.",
        'AC1027': "Cinq versions l'ont utilisé : c'est l'un des formats les plus courants dans les archives de dessins.",
        'AC1024': "AutoCAD 2010, la première version à l'enregistrer, a aussi introduit les contraintes paramétriques et la modélisation de maillages.",
        'AC1021': "C'est le premier format DWG à stocker le texte en Unicode : les dessins conservent leurs caractères quel que soit l'alphabet.",
        'AC1018': "AutoCAD 2004, la première version à l'enregistrer, a introduit les couleurs vraies et les carnets de couleurs.",
        'AC1015': "AutoCAD 2000, la première version à l'enregistrer, a introduit les présentations multiples et les épaisseurs de ligne, dont le traçage dépend encore."}),
'de': dict(
    title='{code}: Welche AutoCAD-Version ist diese DWG?',
    desc='{code} ist das DWG-Format von AutoCAD {fmt}, verwendet von AutoCAD {saved}. Welche Programme es öffnen und wie Sie es kostenlos ansehen.',
    range='{a} bis {b}', current='{a} bis zur aktuellen Version', r2000='2000, 2000i und 2002', save='AutoCAD {y}-Zeichnung (*.dwg)',
    h1='{code}: das DWG-Format von <span class="grad">AutoCAD {fmt}</span>',
    lead='{code} ist der Versionscode des DWG-Formats von AutoCAD {fmt}. Eine Zeichnung, die mit {code} beginnt, wurde mit AutoCAD {saved} gespeichert oder mit einem anderen CAD-Programm, das auf dieses Format eingestellt war. {note}',
    cta1='{code}-Datei kostenlos öffnen', cta2='Version einer Datei prüfen',
    glance='{code} auf einen Blick', r_code='Versionscode', r_name='Formatname', v_name='AutoCAD-{fmt}-Zeichnung', r_saved='Gespeichert von',
    r_opens='Öffnet sich in', v_opens='AutoCAD {fmt} und neuer', r_here='Öffnet sich in DWG Plotter', v_here='Ja, kostenlos im Browser',
    h_soft='Welche Software eine {code}-Datei öffnet',
    p_soft='Jede Version von AutoCAD und AutoCAD LT ab {fmt} öffnet sie, ebenso die meisten anderen CAD-Programme, die DWG lesen. AutoCAD {older} und älter können sie nicht öffnen und zeigen stattdessen einen Fehler.',
    p_view='Ohne AutoCAD ziehen Sie die Datei in den <a href="{pre}/dwg-viewer/">kostenlosen DWG-Viewer</a>: Sie sehen jedes Layout, können zoomen, messen und als PDF speichern. Die Datei wird auf Ihrem Computer gelesen und nie hochgeladen.',
    h_older='In einem älteren AutoCAD öffnen',
    p_older='Bitten Sie den Absender, eine Kopie in einem älteren Format zu speichern: Speichern unter und den Dateityp „AutoCAD 20xx-Zeichnung“ wählen, der zu Ihrer Version passt, etwa „{prevsave}“. Wenn Sie die Zeichnung nur ansehen oder drucken müssen, ist die <a href="{pre}/dwg-to-pdf/">Umwandlung in PDF</a> schneller.',
    h_2000='Warum Programme AC1015 verlangen',
    p_2000='Fast jedes Programm, das DWG oder DXF importiert, auch ältere CNC-, CAM- und GIS-Software, liest das 2000-Format. Deshalb steht in Exporteinstellungen und Dateianfragen oft „AutoCAD-2000-DWG“. Nur Release 14 und älter können es nicht öffnen.',
    h_save='Eine Zeichnung als {code} speichern',
    p_save='Wählen Sie in AutoCAD {fmt} oder neuer Speichern unter und den Dateityp „{save}“. Als Standard legen Sie ihn unter Optionen, Öffnen und Speichern fest. Beim Speichern in einem älteren Format können Objekte vereinfacht werden, die dieses Format nicht kennt. Behalten Sie also auch das Original.',
    save_current='In allen aktuellen Versionen ist es bereits der Standard.',
    h_q='Fragen',
    q1='Welche AutoCAD-Version ist {code}?', a1='Es ist das DWG-Format von AutoCAD {fmt}, verwendet von AutoCAD {saved}.',
    q2='Kann AutoCAD {older} eine {code}-Datei öffnen?', a2='Nein. AutoCAD {older} liest nur bis {prev}. Speichern Sie die Zeichnung als „{prevsave}“ oder sehen Sie sie im Browser an.',
    a2_2000='Nein. Release 14 liest nur bis AC1014. Sehen Sie die Zeichnung im Browser an oder wandeln Sie sie in PDF um.',
    q3='Wie prüfe ich, ob meine Datei {code} ist?', a3='Ziehen Sie sie in den <a href="{pre}/dwg-version-checker/">DWG-Versionsprüfer</a> oder öffnen Sie sie in einem Texteditor: Die ersten sechs Zeichen sind der Versionscode.',
    q4='Verwenden DXF-Dateien denselben Code {code}?', a4='Ja. Eine DXF-Datei speichert denselben Code nach $ACADVER am Anfang. Eine als {code} markierte DXF ist also im {fmt}-Format.',
    h_other='Weitere DWG-Versionen', all='Alle Versionen in einer Tabelle',
    notes={
        'AC1032': 'Es ist das bisher langlebigste DWG-Format: Alle Versionen seit 2018 speichern noch darin, die meisten heutigen Zeichnungen sind also AC1032.',
        'AC1027': 'Fünf Versionen haben es verwendet, daher gehört es zu den häufigsten Versionen in Zeichnungsarchiven.',
        'AC1024': 'AutoCAD 2010, die erste Version, die es speicherte, führte auch parametrische Abhängigkeiten und Netzmodellierung ein.',
        'AC1021': 'Es war das erste DWG-Format, das Text als Unicode speichert. Zeichnungen behalten ihre Zeichen also in jedem Alphabet.',
        'AC1018': 'AutoCAD 2004, die erste Version, die es speicherte, führte True Color und Farbbücher ein.',
        'AC1015': 'AutoCAD 2000, die erste Version, die es speicherte, führte mehrere Layouts und Linienstärken ein, auf denen das Plotten bis heute beruht.'}),
'zh': dict(
    title='{code} 是哪个 AutoCAD 版本的 DWG？',
    desc='{code} 是 AutoCAD {fmt} DWG 格式，AutoCAD {saved} 使用该格式。哪些软件能打开、如何保存为该格式，以及如何免费查看。',
    range='{a} 至 {b}', current='{a} 至当前版本', r2000='2000、2000i 和 2002', save='AutoCAD {y} 图形 (*.dwg)',
    h1='{code}：<span class="grad">AutoCAD {fmt}</span> DWG 格式',
    lead='{code} 是 AutoCAD {fmt} DWG 格式的版本代码。以 {code} 开头的图纸由 AutoCAD {saved} 保存，或由设置为该格式的其他 CAD 程序保存。{note}',
    cta1='免费打开 {code} 文件', cta2='检查文件版本',
    glance='{code} 概览', r_code='版本代码', r_name='格式名称', v_name='AutoCAD {fmt} 图形', r_saved='保存它的版本',
    r_opens='可在以下版本打开', v_opens='AutoCAD {fmt} 及更高版本', r_here='能否在 DWG Plotter 中打开', v_here='能，在浏览器中免费打开',
    h_soft='哪些软件能打开 {code} 文件',
    p_soft='{fmt} 及之后的所有 AutoCAD 和 AutoCAD LT 版本都能打开它，大多数能读取 DWG 的其他 CAD 程序也可以。AutoCAD {older} 及更早版本无法打开，会显示错误。',
    p_view='没有 AutoCAD 时，把文件拖入<a href="{pre}/dwg-viewer/">免费 DWG 查看器</a>：可以查看每个布局、缩放、测量并保存为 PDF。文件在您的电脑上读取，绝不会上传。',
    h_older='在旧版 AutoCAD 中打开',
    p_older='请发送者另存一份旧格式的副本：选择“另存为”，再选与您版本相符的“AutoCAD 20xx 图形”文件类型，例如“{prevsave}”。如果只需查看或打印图纸，<a href="{pre}/dwg-to-pdf/">转换为 PDF</a> 更快。',
    h_2000='为什么很多程序要求 AC1015',
    p_2000='几乎所有能导入 DWG 或 DXF 的程序，包括较旧的 CNC、CAM 和 GIS 软件，都能读取 2000 格式。因此导出设置和文件要求中常写“AutoCAD 2000 DWG”。只有 Release 14 及更早版本无法打开它。',
    h_save='将图纸保存为 {code}',
    p_save='在 AutoCAD {fmt} 或更高版本中，选择“另存为”，并将文件类型设为“{save}”。要设为默认格式，请在“选项”的“打开和保存”中修改。保存为旧格式可能会简化该格式不支持的对象，因此请同时保留原文件。',
    save_current='它已是所有当前版本的默认格式。',
    h_q='常见问题',
    q1='{code} 是哪个 AutoCAD 版本？', a1='它是 AutoCAD {fmt} DWG 格式，AutoCAD {saved} 使用该格式。',
    q2='AutoCAD {older} 能打开 {code} 文件吗？', a2='不能。AutoCAD {older} 最高只能读取 {prev}。请将图纸另存为“{prevsave}”，或在浏览器中查看。',
    a2_2000='不能。Release 14 最高只能读取 AC1014。请在浏览器中查看图纸，或将其转换为 PDF。',
    q3='如何确认我的文件是否为 {code}？', a3='把它拖入<a href="{pre}/dwg-version-checker/">DWG 版本检查器</a>，或用纯文本编辑器打开：前六个字符就是版本代码。',
    q4='DXF 文件也使用同样的 {code} 代码吗？', a4='是的。DXF 文件在开头附近的 $ACADVER 之后保存同样的代码，因此标为 {code} 的 DXF 就是 {fmt} 格式。',
    h_other='其他 DWG 版本', all='所有版本一览表',
    notes={
        'AC1032': '这是迄今使用时间最长的 DWG 格式：2018 年以来的所有版本仍以它保存，所以如今大多数图纸都是 AC1032。',
        'AC1027': '共有五个版本使用它，因此它是图纸档案中最常见的版本之一。',
        'AC1024': '首个保存该格式的 AutoCAD 2010 还引入了参数化约束和网格建模。',
        'AC1021': '它是第一个以 Unicode 存储文字的 DWG 格式，因此任何文字的图纸都能保留原有字符。',
        'AC1018': '首个保存该格式的 AutoCAD 2004 引入了真彩色和配色系统。',
        'AC1015': '首个保存该格式的 AutoCAD 2000 引入了多布局和线宽，打印至今仍依赖这两项。'}),
}


def body(lang, code, fmt, first, last, older, prev):
    t, pre = T[lang], PRE[lang]
    saved = t['r2000'] if code == 'AC1015' else (t['current'] if last is None else t['range']).format(a=first, b=last)
    v = dict(code=code, fmt=fmt, saved=saved, older=older, prev=prev, pre=pre, note=t['notes'][code],
             save=t['save'].format(y=SAVE_YEAR[code]), prevsave=t['save'].format(y=SAVE_YEAR.get(prev, '')))
    f = lambda k: t[k].format(**v)
    save_p = f('p_save') + (' ' + t['save_current'] if last is None else '')
    if code == 'AC1015':
        older_sec, a2 = f'<h2>{t["h_2000"]}</h2>\n<p>{t["p_2000"]}</p>', t['a2_2000']
    else:
        older_sec, a2 = f'<h2>{f("h_older")}</h2>\n<p>{f("p_older")}</p>', f('a2')
    others = ' · '.join(f'<a href="{pre}/{c.lower()}/">{c} ({y})</a>' for c, y, *_ in CODES if c != code)
    return f'''<h1>{f("h1")}</h1>
<p class="lead">{f("lead")}</p>
<p><a class="cta" href="{pre}/">{f("cta1")}</a> <a class="cta ghost" href="{pre}/dwg-version-checker/">{t["cta2"]}</a></p>

<h2>{f("glance")}</h2>
<table class="tbl">
  <tbody>
    <tr><th>{t["r_code"]}</th><td>{code}</td></tr>
    <tr><th>{t["r_name"]}</th><td>{f("v_name")}</td></tr>
    <tr><th>{t["r_saved"]}</th><td>AutoCAD {saved}</td></tr>
    <tr><th>{t["r_opens"]}</th><td>{f("v_opens")}</td></tr>
    <tr><th>{t["r_here"]}</th><td>{t["v_here"]}</td></tr>
  </tbody>
</table>

<h2>{f("h_soft")}</h2>
<p>{f("p_soft")}</p>
<p>{f("p_view")}</p>

{older_sec}

<h2>{f("h_save")}</h2>
<p>{save_p}</p>

<h2>{t["h_q"]}</h2>
<h3>{f("q1")}</h3>
<p>{f("a1")}</p>
<h3>{f("q2")}</h3>
<p>{a2}</p>
<h3>{f("q3")}</h3>
<p>{f("a3")}</p>
<h3>{f("q4")}</h3>
<p>{f("a4")}</p>

<h2>{t["h_other"]}</h2>
<p>{others} · <a href="{pre}/dwg-versions/">{t["all"]}</a></p>
''', f('title'), f('desc')


def main():
    lines = ['# One page per DWG version code, in each language (written by tools/make_versions.py, sourced by make.sh)']
    for lang in LANGS:
        for row in CODES:
            text, title, desc = body(lang, *row)
            out = PAGES / (f'{row[0].lower()}.body.html' if lang == 'en' else f'{lang}/{row[0].lower()}.body.html')
            out.write_text(text, encoding='utf-8', newline='\n')
            assert '"' not in title + desc and '$' not in title + desc and '`' not in title + desc
            lines.append(f'page {lang} {row[0].lower()} "{title}" "{desc}"')
        lines.append('')
    (PAGES / 'versions.sh').write_text('\n'.join(lines), encoding='utf-8', newline='\n')

    # link the codes from the version table and the version checker
    linked = '|'.join(c for c, *_ in CODES)
    for lang in LANGS:
        sub = '' if lang == 'en' else f'{lang}/'
        p = PAGES / f'{sub}dwg-versions.body.html'
        p.write_text(re.sub(rf'<td>({linked})</td>', lambda m: f'<td><a href="{PRE[lang]}/{m[1].lower()}/">{m[1]}</a></td>',
                            p.read_text(encoding='utf-8')), encoding='utf-8', newline='\n')
        p = PAGES / f'{sub}dwg-version-checker.body.html'
        p.write_text(re.sub(rf'<li><strong>({linked})([^<]*)</strong>', lambda m: f'<li><strong><a href="{PRE[lang]}/{m[1].lower()}/">{m[1]}{m[2]}</a></strong>',
                            p.read_text(encoding='utf-8')), encoding='utf-8', newline='\n')
    print(f'wrote {len(LANGS) * len(CODES)} pages and pages/versions.sh')


if __name__ == '__main__':
    main()
