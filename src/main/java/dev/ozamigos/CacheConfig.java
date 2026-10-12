package dev.ozamigos;

import java.util.Arrays;
import java.util.concurrent.TimeUnit;

import org.springframework.boot.autoconfigure.web.WebProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Regras de cache da interface.
 *
 * <p>O jar sai com todos os arquivos datados de 1980. Sem regra nenhuma, o navegador (e o app para
 * Windows) concluía que o index.html "não muda há 46 anos" e o guardava por anos, mostrando a
 * interface antiga depois de cada deploy. Agora:
 * <ul>
 *   <li>o index.html e os demais arquivos são sempre conferidos com o servidor ({@code no-cache}, em
 *       application.properties, sem a data de 1980);</li>
 *   <li>os arquivos de /assets têm o hash do conteúdo no nome: uma versão nova tem nome novo, então
 *       podem ficar guardados por um ano.</li>
 * </ul>
 */
@Configuration
public class CacheConfig implements WebMvcConfigurer {

    private final String[] pastasDeAssets;

    public CacheConfig(WebProperties propriedades) {
        this.pastasDeAssets = Arrays.stream(propriedades.getResources().getStaticLocations())
                .map(pasta -> pasta.endsWith("/") ? pasta + "assets/" : pasta + "/assets/")
                .toArray(String[]::new);
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registro) {
        registro.addResourceHandler("/assets/**")
                .addResourceLocations(pastasDeAssets)
                .setCacheControl(CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable())
                .setUseLastModified(false);
    }
}
