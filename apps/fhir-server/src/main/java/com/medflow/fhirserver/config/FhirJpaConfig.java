package com.medflow.fhirserver.config;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.jpa.api.config.JpaStorageSettings;
import ca.uhn.fhir.jpa.config.r4.JpaR4Config;
import ca.uhn.fhir.jpa.util.HapiEntityManagerFactoryUtil;
import jakarta.persistence.EntityManagerFactory;
import java.util.Properties;
import javax.sql.DataSource;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/**
 * Configures the HAPI FHIR R4 JPA persistence layer.
 *
 * <p>Imports {@link JpaR4Config} (which transitively wires the DAO registry, search-parameter
 * registry, Batch2 support and the generated R4 resource providers / system DAO) and supplies the
 * application-owned infrastructure beans: the {@link JpaStorageSettings}, the HAPI-configured
 * {@link EntityManagerFactory} and the {@link JpaTransactionManager}. The application excludes
 * Spring Boot's Hibernate auto-configuration (see {@code Application}) so it does not create a
 * competing entity manager factory.
 */
@Configuration
@EnableTransactionManagement
@Import(JpaR4Config.class)
public class FhirJpaConfig {

  /**
   * Configures JPA storage settings, allowing external references and multi-delete.
   *
   * @return the storage settings
   */
  @Bean
  public JpaStorageSettings storageSettings() {
    final JpaStorageSettings settings = new JpaStorageSettings();
    settings.setAllowExternalReferences(true);
    settings.setAllowMultipleDelete(true);
    settings.setIndexMissingFields(JpaStorageSettings.IndexEnabledEnum.DISABLED);
    settings.setDefaultSearchParamsCanBeOverridden(true);
    return settings;
  }

  /**
   * Builds the HAPI-configured JPA entity manager factory.
   *
   * <p>Uses {@link HapiEntityManagerFactoryUtil} so the correct entity packages, naming strategies
   * and HAPI Hibernate customizations are applied (persistence unit {@code HAPI_PU}).
   *
   * @param beanFactory     the configurable bean factory required by the HAPI helper
   * @param dataSource      the configured PostgreSQL datasource
   * @param fhirContext     the R4 FHIR context
   * @param storageSettings the JPA storage settings
   * @return the entity manager factory bean for the HAPI persistence unit
   */
  @Bean
  public LocalContainerEntityManagerFactoryBean entityManagerFactory(
      final ConfigurableListableBeanFactory beanFactory,
      final DataSource dataSource,
      final FhirContext fhirContext,
      final JpaStorageSettings storageSettings) {
    final LocalContainerEntityManagerFactoryBean factory =
        HapiEntityManagerFactoryUtil.newEntityManagerFactory(
            beanFactory, fhirContext, storageSettings);
    factory.setPersistenceUnitName("HAPI_PU");
    factory.setDataSource(dataSource);
    factory.setJpaProperties(jpaProperties());
    return factory;
  }

  /**
   * Builds the JPA transaction manager backing the HAPI persistence unit.
   *
   * @param entityManagerFactory the HAPI entity manager factory
   * @return the primary transaction manager
   */
  @Bean
  @Primary
  public PlatformTransactionManager transactionManager(
      final EntityManagerFactory entityManagerFactory) {
    final JpaTransactionManager manager = new JpaTransactionManager();
    manager.setEntityManagerFactory(entityManagerFactory);
    return manager;
  }

  private Properties jpaProperties() {
    final Properties props = new Properties();
    props.put("hibernate.dialect", "ca.uhn.fhir.jpa.model.dialect.HapiFhirPostgres94Dialect");
    props.put("hibernate.format_sql", "false");
    props.put("hibernate.show_sql", "false");
    props.put("hibernate.hbm2ddl.auto", "update");
    props.put("hibernate.hbm2ddl.charset_name", "UTF-8");
    // Mirror the HAPI starter defaults so generated schema and queries align.
    props.put("hibernate.boot.allow_jdbc_metadata_access", "true");
    props.put("hibernate.archive.scanner",
        "org.hibernate.boot.archive.scan.internal.DisabledScanner");
    props.put("hibernate.implicit_naming_strategy",
        "org.springframework.boot.orm.jpa.hibernate.SpringImplicitNamingStrategy");
    props.put("hibernate.physical_naming_strategy",
        "org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy");
    props.put("hibernate.cache.use_query_cache", "false");
    props.put("hibernate.cache.use_second_level_cache", "false");
    props.put("hibernate.search.enabled", "false");
    return props;
  }
}
