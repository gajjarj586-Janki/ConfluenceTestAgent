Feature: Model Variant Carousel Navigation Performance

  @performance @pip @variant-carousel
  Scenario Outline: Verify variant carousel navigation performance across model pages
    Given user navigates to "<pageUrl>"
    When user clicks on the "<variantTab>" variant tab
    Then the target page should load successfully
    And the current URL should not contain "?id="
    And the page response time should be less than 200 ms
    And no renderer long task longer than 200 ms should occur

    Examples:
      | pageUrl | variantTab |
      | https://stage.hyundai.com.au/au/en/cars/suvs/kona | KONA Hybrid |
      | https://stage.hyundai.com.au/au/en/cars/suvs/kona | KONA Electric |
      | https://stage.hyundai.com.au/au/en/cars/suvs/santa-fe | SANTA FE Hybrid |
      | https://stage.hyundai.com.au/au/en/cars/small-cars/i30-hatch-n-line | i30 N |
      | https://stage.hyundai.com.au/au/en/cars/small-cars/i30-sedan | i30 Sedan Hybrid |
      | https://stage.hyundai.com.au/au/en/cars/small-cars/i30-sedan | i30 Sedan N |