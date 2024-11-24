var INITIAL_ZOOM = 3;
var INITIAL_COORDS = [63.31122971681907, 92.47689091219665];

var map = L.map('map').setView(INITIAL_COORDS, INITIAL_ZOOM);


var DISABLE_TILE_COLORS_RENDERING = false;


class FederalDistrictLoader {
    constructor(map) {
        this.map = map;
        this._raw_result = null;
    }

    async _load() {
        const response = await fetch("/api/fd");
        const reader = response.body.getReader();

        let result = '';
        let result_items = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            for (let item of (new TextDecoder('utf-8').decode(value)).split('\n\n')) {
                result += item;
                try {
                    let d = JSON.parse(result);

                    result_items.push(d);
                    result = "";
                } catch (e) { }
            }
        }

        this._raw_result = result_items;
    }

    _process_raw_result() {
        if (!this._raw_result) {
            throw new Error("API Response is empty. Try to load data first");
        }

        let levels = { "federal_district": [], "regions": [] };

        for (let d of this._raw_result) {
            let names = new Set(levels["federal_district"].map(item => item.properties.name));
            if (names.has(d.name)) {
                continue;
            }

            if (d.name.toLowerCase().includes('дальневосточный федеральный округ')) {
                d.geojson.coordinates = d.geojson.coordinates.filter(polygon => 
                    !polygon.some(part => 
                        part.some(coords => coords.length === 2 && (coords[0] < 0 || coords[1] < 0))
                    )
                );
            }

            let polygon = turf.feature(d.geojson);
            if (!polygon.properties) {
                polygon.properties = {};
            }
            polygon.properties.name = d.name;

            if (d.name.toLowerCase().includes("федеральный округ")) {
                levels["federal_district"].push(polygon);

            } else {
                let names = new Set(levels["regions"].map(item => item.properties.name));
                if (names.has(d.name)) {
                    continue;
                }

                levels["regions"].push(polygon);
            }
        }
        
        levels["federal_district"] = levels["federal_district"].sort((a, b) => {
            return turf.area(a) - turf.area(b);
        });
        let processedRegions = [];
        for (let d of levels["regions"]) {
            for (let fd_obj of levels["federal_district"]) {
                let names = new Set(processedRegions.map(item => item.properties.name));
                if (names.has(d.properties.name)) {
                    continue;
                }

                let fd_geojson = L.geoJSON(fd_obj);
                let reg_geojson = L.geoJSON(d);

                if (fd_geojson.getBounds().contains(reg_geojson.getBounds())) {
                    d.properties.federal_district = fd_obj.properties.name;
                    processedRegions.push(d);
                }
            }
        }

        levels["regions"] = processedRegions;
        
        let obj = {
            "regions": turf.featureCollection(levels["regions"]),
            "federal_districts": turf.featureCollection(levels["federal_district"])
        }
        if (!window._data || Object.keys(window._data).length === 0) {
            window._data = obj;
        }
        return obj;
    }


    async getFeatureCollection(simplify = false) {
        if (!this._raw_result) {
            await this._load();
        }
        let featureCollection = this._process_raw_result();
        if (simplify) {
            featureCollection = turf.simplify(featureCollection, { tolerance: 0.01, highQuality: true });
        }
        return featureCollection;
    }
}

var isPinned = false;


class infoPanelWidget {
    constructor() {
        this._boundsSource = map;
        this._infoControl = L.control.custom({ position: 'topright' });
        this._infoControl.onAdd = function (map) {
            this._div = L.DomUtil.create('div', 'info');
            this._div.style.backgroundColor = 'white';
            this._div.style.padding = '10px';
            this._div.style.borderRadius = '5px';
            this._div.style.width = '300px';
            this._div.style.opacity = "30%";
            this._div.style.transition = 'right 0.3s, opacity 0.3s';
            this._div.style.position = 'relative';
            this._div.style.bottom = '30px';
            this._div.style.top = '30px';
            this._div.style.right = '-70%';
            this._div.style.maxHeight = '80vh';
            this._div.style.overflowY = 'auto';
            this._div.style.pointerEvents = 'all'

            this.isPinned = false;
            this._div.addEventListener('mouseenter', () => {
                if (!isPinned) { // Если не закреплено, выезжает
                    this._div.style.right = '0'; // Выезжает на 100%
                    this._div.style.opacity = "1"; // Полная непрозрачность
                }
            });

            this._div.addEventListener('wheel', (e) => {
                e.stopPropagation(); // Предотвращаем всплытие события
            });

            this._div.addEventListener('mouseleave', () => {
                if (!isPinned) { // Если не закреплено, скрывается
                    this._div.style.right = '-70%'; // Скрывается на 70%
                    this._div.style.opacity = "0.3"; // Возвращается к прозрачности 30%
                }
            });
    
            this.update();
            return this._div;
        };
    }

    setBoundsSource(e) {
        if (!(e instanceof L.Layer || e instanceof L.Map)) {
            return
        }
        this._boundsSource = e;
    }

    getEcTypesCount() {
        let ecTypesCount = {};
        for (let ec of window._data.markersData) {
            let coords = ec.coords ? ec.coords[0].split(",") : [];
            if (coords.length === 2) {
                var bounds = this._boundsSource.getBounds();

                if (!bounds.contains(L.latLng(coords))) {
                    continue;
                }
            }
            let type;

            if (ec.type_ec.toLowerCase().includes('зональный')) {
                type = "Зональный центр";
            } else if (ec.type_ec.toLowerCase().includes("региональный")) {
                type = "Региональный центр"
            } else {
                throw new Error(ec.type_ec)
            }

            if (ecTypesCount[type]) {
                ecTypesCount[type] += 1;
            } else {
                ecTypesCount[type] = 1;
            }
        }
        return ecTypesCount;
    }

    getOrgsCount() {
        let count = {};
        for (let org of window._data.orgs) {
            let coords = org.coords ? org.coords[0].split(",") : [];

            if (coords.length !== 2) {
                continue;
            }

            var bounds = this._boundsSource.getBounds();

            if (this._boundsSource instanceof L.Map) {
                if (!bounds.contains(L.latLng(coords))) {
                    continue;
                }
            } else {
                if (!turf.booleanPointInPolygon(turf.point(coords), this._boundsSource.toGeoJSON())) { // Проверяем, содержится ли точка в полигоне
                    continue;
                }
            }


            let type = org.type_org;
            if (count[type]) {
                count[type] += 1;
            } else {
                count[type] = 1;
            }
        }

        return count;
    }

    getInfoPanel() {
        let infoControl = this._infoControl;
        var getEcTypesCount = this.getEcTypesCount.bind(this);
        var getOrgsCount = this.getOrgsCount.bind(this);
        var getBoundsSource = (function() {return this._boundsSource}).bind(this);

        infoControl.update = function (props) {
            let ecTypesCount = getEcTypesCount();
            let orgsCount = getOrgsCount();
            let btn_text = 'Закрепить';

            if (isPinned) {
                btn_text = "Открепить";
            }
            let boundsSource = getBoundsSource();
            let name;

            if (boundsSource instanceof L.Map) {
                name = "ДОСААФ";
            } else {
                name = boundsSource.feature.properties.name
            }

            this._div.innerHTML = `
            <button class="pin-button">${btn_text}</button>
            <h2>${name}.<br>Краткая информация</h2>
                <h4>
                Всего организаций: ${Object.values(orgsCount).reduce((sum, count) => sum + count, 0)} </br>
                Всего ЕЦ: ${Object.values(ecTypesCount).reduce((sum, count) => sum + count, 0)}
                </h4>
            <h4>Единые центры</h4>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Тип единого центра</th>
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Количество ЕЦ</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(ecTypesCount).map(([type, count]) => `
                        <tr>
                        <td style="border: 1px solid #ddd; padding: 8px;">${type}</td>
                        <td style="border: 1px solid #ddd; padding: 8px;">${count}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <h4>Организации</h4>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Тип организации</th>
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Количество организаций</th>
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Действие</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(orgsCount).map(([type, count]) => `
                        <tr>
                        <td style="border: 1px solid #ddd; padding: 8px;">${type === "null" ? "Неизвестно" : type}</td>
                        <td style="border: 1px solid #ddd; padding: 8px;">${count  || "Неизвестно"}</td>
                        <td style="border: 1px solid #ddd; padding: 8px;">
                            <button onclick="showTypeOrg('${type}')">Показать на карте</button>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            `
            
            let btn = this._div.getElementsByClassName("pin-button")[0];
            btn.onclick = function(e) {
                isPinned = !isPinned
                let btn_text = 'Закрепить';

                if (isPinned) {
                    btn_text = "Открепить";
                }

                btn.textContent = btn_text
            }
        };

        return infoControl;
    }
}


var fd_loader = new FederalDistrictLoader(map);


function showTypeOrg(type) {
    window._markers.clearLayers();
    for (let org of window._data.orgs) {
        if (org.type_org !== type) {
            continue;
        }
        loadOrganizationMarker(org);
    }
}


function objectToString(obj) {
    let result = '';
    for (let [key, value] of Object.entries(obj)) {
        if (!value) {
            value = '';
        };
        result += `${key}: ${value}<br>`;
    }
    return result.trim();
}


function getDataFromOrg(org) {
    let data = {
        name: org.full_name,
        type_org: org.type_org,

        address: org.address,
        coords: org.coords,
        federal_district: org.federal_district,
        region: org.region,

        phones: org.contact_phones,
        emails: org.contact_emails,
        websites: org.websites,

        ein: org.ein,
        kpp: org.kpp,
        personals: org.personals,
        listorg: org.link_listorg,
    }
    return data
}

function getDataFromEC(ec) {
    let data = {
        name: ec.name,
        type_ec: ec.type_ec,

        related_organisations: ec.organisations,
        type_ec: ec.type_ec,

        address: ec.address,
        coords: ec.coords,
        federal_district: ec.federal_district,
        region: ec.region,
    }
    return data
}


async function getOrgs(eins = null) {
    let url = `/api/organizations`;
    if (eins) {
        url = `/api/organizations?eins=${eins}`
    }

    let response = await fetch(url);
    let organizations = await response.json();
    return organizations;
}


function loadOrganizations(organisations) {
    let orgs = [];
    for (let organization of organisations) {
        // load coordinates
        let coords = [0, 0];
        if (organization.coords && organization.coords[0]) {
            coords = organization.coords[0].split(',').map(num => parseFloat(num.trim()));
        }

        // load display data
        let dataObject = getDataFromOrg(organization);
        let dataString = objectToString(dataObject);

        // let marker = L.marker(coords);
        // marker.bindPopup(dataString);
        // marker.bindTooltip(dataObject.name);
        // marker.addTo(window._markers);
        orgs.push(dataObject)
    }
    // markers.addTo(map);
    if (!window._data.orgs || window._data.orgs.length === 0) {
        window._data.orgs = orgs
    }
}

var sidebar = L.control.sidebar('sidebar', {
    position: 'right'
});
map.addControl(sidebar);    
sidebar.on("hidden", function() {
    sidebar.setContent("");
})



function loadOrganizationMarker(organisationData) {
    let org = organisationData;

    let marker = L.marker(org.coords[0].split(","))
    .addTo(window._markers);
    marker.on("click", function(e) {
        if (sidebar.isVisible()) {
            sidebar.hide()
        }

        let data = {
            "Тип организации": org.type_org,
            "ИНН организации": org.ein,
            "КПП организации": org.kpp,
            "Кол-во персонала": org.personals,
            "Регион": org.region,
            "Федеральный округ": org.federal_district,
            "Адрес": org.address,
            "Координаты": org.coords,
        }
        
        let contactsData = {
            "Телефон": (org.phones && org.phones.length > 0) ? org.phones.join(", ") : "Нету данных",
            "Почта": (org.emails && org.emails.length > 0) ? org.emails.join(", ") : "Нету данных",
            "Сайт": org.websites[0] || "Нету данных",
            "Профиль на ListOrg": org.listorg ? 
                `<a href="${org.listorg}" target="_blank" style="text-decoration: none;">
                    <button style="padding: 10px 20px;">Открыть профиль</button>
                </a>` : 
                "Нету данных",
        }

        sidebar.setContent(
            `
            <div style="display: flex; flex-direction: column; height: 100%;">
                <h3>${org.name}</h3>
                <h3>Основная информация</h3>
                <div style="width: 100%; border-collapse: collapse; flex-grow: 1;">
                    ${Object.entries(data).map(([key, value]) => `
                        <div class="data-row">
                            <span class="data-key">${key}:</span>
                            <span class="data-value">${value}</span>
                        </div>
                    `).join('')}
                    
                    <a href="https://yandex.ru/maps?mode=search&text=${org.coords}" target="_blank" style="text-decoration: none;">
                        <button >Открыть на Яндекс.Картах</button>
                    </a>
                    <a href="https://2gis.ru/search/${org.coords}" target="_blank" style="text-decoration: none;">
                        <button >Открыть в 2GIS</button>
                    </a>
                    <a href="https://pkk.rosreestr.ru/#/search/50.39212997282373,127.5592176766207/11/@541ls89ah?text=${org.coords}&type=1" target="_blank" style="text-decoration: none;">
                        <button>Открыть кадастровую карту</button>
                    </a>
                </div>

                <h3>Контактная информация</h3>
                <div style="width: 100%; border-collapse: collapse; flex-grow: 1;">
                    ${Object.entries(contactsData).map(([key, value]) => `
                        <div class="data-row">
                            <span class="data-key">${key}:</span>
                            <span class="data-value">${value}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            `
        )
        sidebar.show();
    })
}


async function loadEC() {
    let response = await fetch('/api/ec');
    let ecs = await response.json();
    

    if (!window._data.markersData) {
        window._data.markersData = [];
    }

    for (let ec of ecs) {
        let coords = [0, 0];
        if (ec.coords && ec.coords[0]) {
            coords = ec.coords[0].split(',').map(num => parseFloat(num.trim()));
        }

        let names = new Set(window._data.markersData.map(i => i.name))
        let dataObject = getDataFromEC(ec);

        if (names.has(dataObject.name)) {
            continue;
        }

        let dataString = objectToString(dataObject);

        let type_ec = ec.type_ec;
        let backgroundColor;
        if (type_ec.toLowerCase().includes("зональный")) {
            type_ec = 'ЗЦ';
            backgroundColor = 'rgb(49, 161, 64)';
        } else if (type_ec.toLowerCase().includes("региональный")) {
            type_ec = 'РЦ';
            backgroundColor = 'rgba(246, 53, 39, 0.78)';
        }
        else {
            throw new Error(`Unknown type_ec: ${ec.type_ec} ${ec}`);
        }

        let marker = L.marker(coords, {
            icon: L.BeautifyIcon.icon({
                isAlphaNumericIcon: true,
                text: type_ec,
                textColor: 'white',
                borderColor: 'black',
                backgroundColor: backgroundColor,
                customClasses: 'ec-marker',
                iconSize: [30, 30],
                borderWidth: 1,
            }),
        })

        marker.bindTooltip(dataObject.name);
        marker.on("click", function(e) {
            if (sidebar.isVisible()) {
                sidebar.hide()
            }

            let data = {
                "Тип": dataObject.type_ec,
                "Адрес": dataObject.address,
                "Регион": dataObject.region,
                "Федеральный округ": dataObject.federal_district,
                "Координаты": dataObject.coords,
            }

            sidebar.setContent(
                `
                <div style="display: flex; flex-direction: column; height: 100%;">
                    <h3>${dataObject.name}</h3>
                    <div style="width: 100%; border-collapse: collapse; flex-grow: 1;">
                        ${Object.entries(data).map(([key, value]) => `
                            <div class="data-row">
                                <span class="data-key">${key}:</span>
                                <span class="data-value">${value}</span>
                            </div>
                        `).join('')}
                        
                        <a href="https://yandex.ru/maps?mode=search&text=${dataObject.coords}" target="_blank" style="text-decoration: none;">
                            <button style="padding: 10px 20px;">Открыть на Яндекс.Картах</button>
                        </a>
                        <a href="https://2gis.ru/search/${dataObject.coords}" target="_blank" style="text-decoration: none;">
                            <button style="padding: 10px 20px;">Открыть в 2GIS</button>
                        </a>
                    </div>
                    
                    <div style="padding: 10px; text-align: center;">
                        <button id="organisations_viewer" style="padding: 10px 20px;">Привязанные организации (${dataObject.related_organisations.length})</button>
                    </div>
                </div>
                `
            )
            sidebar.show()
            document.getElementById("organisations_viewer").onclick = function(e) {
                let organisations = window._data.orgs.filter(org => dataObject.related_organisations.includes(org.ein));
                sidebar.hide()

                DISABLE_TILE_COLORS_RENDERING = true;
                hideAllMarkers({remove: true})
                clearHighlight()

                let coordinates = [];
                for (let org of organisations) {
                    loadOrganizationMarker(org)
                    coordinates.push(org.coords[0].split(","));
                }

                let bounds = L.latLngBounds(coordinates.map(coords => L.latLng(coords)));
                map.fitBounds(bounds);
            }
        })

        marker.addTo(window._markers);
        window._data.markersData.push(dataObject);
    }
}


function closeFederalDistricts() {
    map.eachLayer(function(layer) {
        if (!layer.feature || !layer.feature.properties?.name.toLowerCase().includes("федеральный округ")) {
            return;
        }
        map.removeLayer(layer)
        //layer.setStyle({"opacity": 0, "fillOpacity": 0});
        //layer.feature.properties.closed = true;
    })
}


var TARGET_POLYGON_NAME;


function openRegions(federal_district_name) {
    let regions = [];
    for (let regionFeature of window._data["regions"].features) {
        if (regionFeature.properties.federal_district !== federal_district_name) {
            continue;
        }
        regions.push(regionFeature)
    }
    
    L.geoJSON(turf.featureCollection(regions), {
        style: function(e) {
            return {
                "fillColor": "transparent",
                "weight": 1.5,
                "color": "black"
            }
        }
    })
    .on("click", function(e) {
        map.fitBounds(e.layer.getBounds());
        DISABLE_TILE_COLORS_RENDERING = !DISABLE_TILE_COLORS_RENDERING;
    })
    .on('mouseover', function(e) {
        if (DISABLE_TILE_COLORS_RENDERING) {
            return
        }
        var properties = e.layer.feature.properties;
        if (properties.closed === true) {
            return;
        }
        if (highlight !== e.layer) {
            L.popup()
            .setContent(properties.name)
            .setLatLng(e.latlng)
            .openOn(map);
        }
        clearHighlight();
        highlight = e.layer;
        infoPanel.setBoundsSource(highlight);
        var style = {
            fillColor: '#ec0f0f',
            fillOpacity: 0.2,
            stroke: true,
            fill: true,
            color: 'red',
            opacity: 1,
            weight: 2,
        };
        e.layer.setStyle(style);
    })
    .addTo(map);
}


async function loadFD() {
    let featureCollections = await fd_loader.getFeatureCollection();
    let fds = featureCollections["federal_districts"];

    L.geoJSON(fds, {
        style: function(f) {
            return {
                fillColor: "transparent",
                fillOpacity: 0.5,
                fill: true,
                color: 'black',
                weight: 1.5,
            }
        }
    })
    .on('mouseover', function(e) {
        if (DISABLE_TILE_COLORS_RENDERING) {
            return
        }
        var properties = e.layer.feature.properties;
        if (properties.closed === true) {
            return;
        }
        if (highlight !== e.layer) {
            let latlng = e.layer.getCenter();
            if (properties.name.toLowerCase().includes("дальневосточный федеральный округ")) {
                latlng = e.latlng;
            }
            L.popup()
            .setContent(properties.name)
            .setLatLng(latlng)
            .openOn(map);
        }
        clearHighlight();
        highlight = e.layer;
        infoPanel.setBoundsSource(highlight);
        var style = {
            fillColor: '#ec0f0f',
            fillOpacity: 0.2,
            stroke: true,
            fill: true,
            color: 'red',
            opacity: 1,
            weight: 2,
        };
        e.layer.setStyle(style);
    })
    .on("click", function(e) {
        console.log(e.layer.feature.properties)
        map.fitBounds(e.layer.getBounds());
        openRegions(e.layer.feature.properties.name)
        closeFederalDistricts()
    })
    .addTo(map);
}


async function loadMD() {
    const response = await fetch("/api/md");
    const reader = response.body.getReader();

    let result = '';
    let result_items = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        for (let item of (new TextDecoder('utf-8').decode(value)).split('\n\n')) {
            result += item;
            try {
                let d = JSON.parse(result);
                result = "";
            } catch (e) { }
        }
    }
}


async function loadPolygons() {
    await loadFD();
    //await loadMD();
}


async function loadMarkers() {
    let orgs = await getOrgs();
    loadOrganizations(orgs)
    await loadEC();
}


function ecPopup(title, content, relatedOrgsEins = null) {
    let popup = L.popup({
        closeButton: false,
        autoClose: false,
        className: 'ec-popup'
    })
        .setContent(`
        <div class="popup-title">${title}</div>
        <div class="popup-content">${content}</div>
        <button class="popup-close-btn">Закрыть</button>
    `);

    popup.on('add', async function (e) {
        e.target.getElement().querySelector('.popup-close-btn').addEventListener('click', async function () {
            map.closePopup(popup);
        });
    });

    return popup;
}



function hideAllMarkers(curr = null, remove = false) {
    window._markers.clearLayers()
    map.eachLayer(function (layer) {
        if (layer instanceof L.Marker && layer !== curr) {
            if (remove) {
                map.removeLayer(layer)
            } else {
                layer.setOpacity(0);
            }
        }
    });
}


async function loadTileTogler() {

    new L.basemapsSwitcher([
        {
            layer: L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',{
                maxZoom: 20,
                subdomains:['mt0','mt1','mt2','mt3']
            }).addTo(map),
            icon: "{{ url_for('static', filename='map.png')}}",
            name: 'Схема'
        },
        {
            layer: L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
                maxZoom: 20,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
            }),
            icon: "{{ url_for('static', filename='map-hybrid.png')}}",
            name: 'Гибрид'
        },
    ], { position: 'topright' }).addTo(map);

}


var highlight;
var clearHighlight = function() {
    if (highlight) {
        highlight.setStyle({
            fillColor: "transparent",
            fillOpacity: 0.5,
            fill: true,
            color: 'black',
            weight: 1.5,
        });
    }
    highlight = null;
};


async function resetMapStyle() {
    map.eachLayer(function(layer) {
        if (!layer.feature) {
            return;
        }
        map.removeLayer(layer);
    })

    if (sidebar.isVisible()) {
        sidebar.hide()
    }
    DISABLE_TILE_COLORS_RENDERING = false;
    let fds = _data["federal_districts"];

    L.geoJSON(fds, {
        style: function(f) {
            return {
                fillColor: "transparent",
                fillOpacity: 0.5,
                fill: true,
                color: 'black',
                weight: 1.5,
            }
        }
    })
    .on('mouseover', function(e) {
        if (DISABLE_TILE_COLORS_RENDERING) {
            return
        }
        var properties = e.layer.feature.properties;
        if (properties.closed === true) {
            return;
        }
        if (highlight !== e.layer) {
            let latlng = e.layer.getCenter();
            if (properties.name.toLowerCase().includes("дальневосточный федеральный округ")) {
                latlng = e.latlng;
            }
            L.popup()
            .setContent(properties.name)
            .setLatLng(latlng)
            .openOn(map);
        }
        clearHighlight();
        highlight = e.layer;
        infoPanel.setBoundsSource(highlight);
        var style = {
            fillColor: '#ec0f0f',
            fillOpacity: 0.5,
            stroke: true,
            fill: true,
            color: 'red',
            opacity: 1,
            weight: 2,
        };
        e.layer.setStyle(style);
    })
    .on("click", function(e) {
        console.log(e.layer.feature.properties)
        map.fitBounds(e.layer.getBounds());
        openRegions(e.layer.feature.properties.name)
        closeFederalDistricts()
    })
    .addTo(map);

    map.setView(INITIAL_COORDS, INITIAL_ZOOM);
    window._data.markersData = [];
    window._markers.clearLayers()
    await loadMarkers();
}


function getTogglerOrgsButton() {
    let c = L.control.custom(
        {position: "topleft"}
    );

    c.onAdd = function (map) {
        this._isEcVisible = true;
        this._div = L.DomUtil.create('div', 'toggler');
        this._div.innerHTML = '<button id="toggle-button">Показать организации</button>';

        this._div.querySelector('#toggle-button').onclick = async () => {
            
            if (this._isEcVisible) {
                window._markers.clearLayers()
                for (let org of window._data.orgs) {
                    loadOrganizationMarker(org);
                }
                this._div.querySelector('#toggle-button').textContent = 'Показать единые центры';
            } else {
                window._data.markersData = [];
                window._markers.clearLayers()
                await loadEC(); 
                this._div.querySelector('#toggle-button').textContent = 'Показать организации';
            }
            this._isEcVisible = !this._isEcVisible;
        };

        return this._div;
    };

    return c
}


var infoPanel = new infoPanelWidget();
infoPanel.setBoundsSource(map);
var myControl = infoPanel.getInfoPanel();


function setupOtherControls() {
    L.easyButton('<i class="fa-solid fa-rotate-left"></i>', async function(){
        await resetMapStyle()
    }).addTo(map);

    myControl.addTo(map)
    map.on('move mousemove', function(e) {
        myControl.update()
    })

    let toggler = getTogglerOrgsButton();
    toggler.addTo(map);

    map.on("click", function(e) {
        if (DISABLE_TILE_COLORS_RENDERING) {
            return;
        }
        clearHighlight()
        infoPanel.setBoundsSource(map);
        myControl.update();
    })

}


async function main() {
    await loadTileTogler();
    window._markers = L.markerClusterGroup();
    window._markers.addTo(map);

    await loadPolygons();
    await loadMarkers();
    setupOtherControls();
}

main();