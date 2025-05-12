# Genia Code Review Guidelines

This document outlines the code review process and standards for the Genia project. Following these guidelines will help maintain code quality, consistency, and facilitate knowledge sharing among team members.

## Code Review Process

### Before Submitting Code for Review

1. **Self-Review**: Review your own code before submitting it for review.
   - Check for logical errors, edge cases, and potential bugs
   - Ensure code meets the standards outlined in this document
   - Verify that all tests pass

2. **Documentation**: Ensure your code is properly documented.
   - Add JSDoc comments for all public methods and classes
   - Update README or other documentation if necessary

3. **Testing**: Write appropriate tests for your code.
   - Unit tests for individual components and services
   - Integration tests for component interactions
   - End-to-end tests for critical user flows

### During Code Review

1. **Be Respectful**: Provide constructive feedback and be open to suggestions.
2. **Be Specific**: Point to specific lines of code and provide clear explanations.
3. **Be Timely**: Review code promptly to avoid blocking other team members.

## Code Quality Standards

### General Guidelines

1. **Follow Angular Style Guide**: Adhere to the [Angular Style Guide](https://angular.io/guide/styleguide) for component and service organization.
2. **Use TypeScript Features**: Leverage TypeScript's type system to catch errors at compile time.
3. **Keep Functions Small**: Functions should do one thing and do it well.
4. **Avoid Code Duplication**: Extract common functionality into shared services or utilities.
5. **Use Meaningful Names**: Variables, functions, and classes should have descriptive names.

### Angular-Specific Guidelines

1. **Component Structure**:
   - Keep components focused on a single responsibility
   - Use smart/container and dumb/presentational component pattern
   - Limit component size (< 400 lines as a general rule)

2. **Service Usage**:
   - Use services for data access and business logic
   - Inject services rather than instantiating them directly
   - Keep services focused on a specific domain

3. **Template Guidelines**:
   - Keep templates simple and readable
   - Use structural directives appropriately
   - Avoid complex logic in templates

4. **Reactive Programming**:
   - Use RxJS operators effectively
   - Properly manage subscriptions to avoid memory leaks
   - Use async pipe in templates when possible

### Syncfusion Component Guidelines

1. **Prefer Syncfusion Components**: Use Syncfusion components when available instead of creating custom implementations.
2. **Follow Syncfusion Documentation**: Refer to the Syncfusion documentation for best practices.
3. **Consistent Styling**: Apply consistent styling to Syncfusion components throughout the application.

## Code Documentation Standards

1. **JSDoc Comments**: Use JSDoc comments for all public methods and classes.
   ```typescript
   /**
    * Description of what the function does
    * 
    * @param paramName Description of the parameter
    * @returns Description of the return value
    */
   ```

2. **Inline Comments**: Use inline comments for complex logic that isn't immediately obvious.

3. **TODO Comments**: Use TODO comments for code that needs future attention, but include a description of what needs to be done.
   ```typescript
   // TODO: Implement error handling for network failures
   ```

## Testing Standards

1. **Test Coverage**: Aim for high test coverage, especially for critical components and services.
2. **Test Organization**: Organize tests to mirror the structure of the code being tested.
3. **Test Naming**: Use descriptive test names that explain what is being tested.
   ```typescript
   it('should display error message when API returns an error', () => {
     // Test implementation
   });
   ```

## Performance Considerations

1. **Change Detection**: Use OnPush change detection strategy for performance-critical components.
2. **Lazy Loading**: Implement lazy loading for feature modules.
3. **Memory Management**: Properly manage subscriptions and event listeners.
4. **Bundle Size**: Be mindful of adding large dependencies that increase bundle size.

## Security Guidelines

1. **Input Validation**: Validate all user inputs, both in the UI and in services.
2. **XSS Prevention**: Use Angular's built-in sanitization for user-generated content.
3. **Secure Communication**: Ensure all API calls use HTTPS.
4. **Sensitive Data**: Never store sensitive data in local storage or session storage.

## Electron-Specific Guidelines

1. **IPC Communication**: Use the established IPC patterns for communication between Angular and Electron.
2. **Main Process Code**: Keep main process code focused and well-organized.
3. **Preload Scripts**: Use preload scripts for secure exposure of main process functionality.

## Continuous Improvement

These guidelines are not set in stone. They should evolve as the project grows and as we learn from our experiences. Suggestions for improvements to these guidelines are always welcome.
